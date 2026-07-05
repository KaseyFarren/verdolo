import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAndConsumeAiCredit } from '@/lib/aiCredits'
import { buildRecapPrompt, callClaude, extractText } from '@/lib/ai'
import { getHealthScore, getStage, getWeekAnchor, todayKey } from '@/lib/agency'
import { addDays } from '@/lib/period'

type PeriodType = 'week' | 'month'

function parseDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// `periodStart` can be any date that falls inside the target period — a week gets snapped to
// that week's Monday, a month gets snapped to the 1st — so the caller can just hand over
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

  const credit = await checkAndConsumeAiCredit(orgId)
  if (!credit.allowed) {
    return NextResponse.json(
      { error: `You've used all ${credit.limit} AI generations included in your ${credit.tierName} plan this month. More seats raise your monthly allowance.` },
      { status: 402 }
    )
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
    const health = stage === 'Churned' ? 'Churned' : getHealthScore(c.last_contacted, today, c.cadence_days || 7)
    return `- ${c.name} (${stage}): ${msgCount} msgs, ${done} tasks done, health: ${health}, last: ${c.last_contacted || 'never'}`
  })

  try {
    const prompt = buildRecapPrompt({ periodType, periodStart: start, periodEnd: end, clientSummaries: summaries, brandVoice })
    const result = await callClaude(apiKey, { model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
    const recap = extractText(result)
    await supabase
      .from('reports')
      .upsert({ org_id: orgId, period_type: periodType, period_start: start, period_end: end, content: recap }, { onConflict: 'org_id,period_type,period_start' })
    return NextResponse.json({ recap, periodType, periodStart: start, periodEnd: end })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
