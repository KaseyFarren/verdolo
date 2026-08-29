import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { checkAndConsumeAiCredit } from '@/lib/aiCredits'
import { rateLimit } from '@/lib/rateLimit'
import { buildRecapPrompt, callClaude, extractText } from '@/lib/ai'
import { getHealthScore, getStage, getWeekAnchor, todayKey } from '@/lib/agency'
import { addDays } from '@/lib/period'

export const maxDuration = 60

type PeriodType = 'week' | 'month'

function parseDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// `periodStart` can be any date that falls inside the target period - a week gets snapped to
// that week's Monday, a month gets snapped to the 1st - so the caller can just hand over
// whatever date the user picked in the backfill UI.
function resolvePeriod(periodType: PeriodType, periodStart?: string) {
  if (periodType === 'week') {
    const start = periodStart ? getWeekAnchor(parseDate(periodStart)) : getWeekAnchor()
    return { start, end: addDays(start, 7) }
  }
  const ref = periodStart ? parseDate(periodStart) : new Date()
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1)
  const next = new Date(ref.getFullYear(), ref.getMonth() + 1, 1)
  return { start: todayKey(first), end: todayKey(next) }
}

export async function POST(request: Request) {
  const { orgId, periodType: rawPeriodType, periodStart: rawPeriodStart } = await request.json()
  const periodType: PeriodType = rawPeriodType === 'month' ? 'month' : 'week'
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, role, orgs(settings)')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not a member of this org' }, { status: 403 })
  if (membership.role !== 'owner' && membership.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brandVoice = (membership.orgs as any)?.settings?.brand_voice as string | undefined

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI generation is not configured yet' }, { status: 500 })

  // Burst guard on top of the monthly credit cap - stops a member scripting a flood of calls.
  if (!(await rateLimit(`ai:${orgId}`, 20, 60))) {
    return NextResponse.json({ error: 'Too many requests - please slow down and try again in a moment' }, { status: 429 })
  }

  const { start, end } = resolvePeriod(periodType, rawPeriodStart)
  const today = todayKey()
  const [{ data: clients }, { data: messages }, { data: doneTasks }] = await Promise.all([
    supabase.from('clients').select('id, name, stage, status, cadence_days, last_contacted').eq('org_id', orgId),
    supabase.from('ai_message_log').select('client_id, created_at').eq('org_id', orgId).gte('created_at', start).lt('created_at', end),
    supabase.from('tasks').select('client_id').eq('org_id', orgId).eq('done', true).gte('completed_at', start).lt('completed_at', end),
  ])

  const summaries = (clients || []).map((c) => {
    const stage = getStage(c)
    const msgCount = (messages || []).filter((m) => m.client_id === c.id).length
    const done = (doneTasks || []).filter((t) => t.client_id === c.id).length
    const health = stage === 'Paused' ? 'Paused' : getHealthScore(c.last_contacted, today, c.cadence_days || 7)
    return `- ${c.name} (${stage}): ${msgCount} msgs, ${done} tasks done, health: ${health}, last: ${c.last_contacted || 'never'}`
  })

  // No client data to summarize (e.g. a fresh org, or right after "reset all data") - skip the
  // AI call entirely rather than let the model invent plausible-sounding clients and numbers,
  // and don't burn an AI credit on a recap that has nothing real to report.
  if (summaries.length === 0) {
    const recap = `No client data yet for this ${periodType} - add clients to start generating recaps.`
    await supabase
      .from('reports')
      .upsert({ org_id: orgId, period_type: periodType, period_start: start, period_end: end, content: recap }, { onConflict: 'org_id,period_type,period_start' })
    revalidateTag(`reports:${orgId}`, { expire: 0 })
    return NextResponse.json({ recap, periodType, periodStart: start, periodEnd: end })
  }

  const credit = await checkAndConsumeAiCredit(orgId)
  if (!credit.allowed) {
    return NextResponse.json(
      { error: `You've used all ${credit.limit} AI generations included in your ${credit.tierName} plan this month. More seats raise your monthly allowance.` },
      { status: 402 }
    )
  }

  try {
    const prompt = buildRecapPrompt({ periodType, periodStart: start, periodEnd: end, today, clientSummaries: summaries, brandVoice })
    const result = await callClaude(
      apiKey,
      { model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] },
      { orgId, route: 'generate-recap' }
    )
    const recap = extractText(result)
    await supabase
      .from('reports')
      .upsert({ org_id: orgId, period_type: periodType, period_start: start, period_end: end, content: recap }, { onConflict: 'org_id,period_type,period_start' })
    // The Reports page caches its server data (including this org's `reports` rows) for up to
    // 60s under the `reports:${orgId}` tag - without this, a reload right after generating a
    // recap can serve a stale RSC payload that's missing the report we just wrote.
    // { expire: 0 } forces an immediate full revalidation (this Next.js version requires a
    // second argument; omitting it only warns and would fall back to stale-while-revalidate
    // semantics for an unmatched profile name).
    revalidateTag(`reports:${orgId}`, { expire: 0 })
    return NextResponse.json({ recap, periodType, periodStart: start, periodEnd: end })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
