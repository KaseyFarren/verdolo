import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAndConsumeAiCredit } from '@/lib/aiCredits'
import { rateLimit } from '@/lib/rateLimit'
import { buildClientUpdatePrompt, callClaude, extractText } from '@/lib/ai'
import { getOffsetDate } from '@/lib/agency'

export const maxDuration = 60

const DEFAULT_PERIOD_DAYS = 14

export async function POST(request: Request) {
  const { orgId, clientId } = await request.json()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not a member of this org' }, { status: 403 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI generation is not configured yet' }, { status: 500 })

  if (!clientId) return NextResponse.json({ error: 'No client specified' }, { status: 400 })

  if (!(await rateLimit(`ai:${orgId}`, 20, 60))) {
    return NextResponse.json({ error: 'Too many requests - please slow down and try again in a moment' }, { status: 429 })
  }

  const { data: client } = await supabase
    .from('clients')
    .select('name, business, platform, service, notes, tone, talking_points, last_contacted')
    .eq('id', clientId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const { data: org } = await supabase.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  const brandVoice = (org?.settings as { brand_voice?: string } | null)?.brand_voice

  const credit = await checkAndConsumeAiCredit(orgId)
  if (!credit.allowed) {
    return NextResponse.json(
      { error: `You've used all ${credit.limit} AI generations included in your ${credit.tierName} plan this month. More seats raise your monthly allowance.` },
      { status: 402 }
    )
  }

  const periodStart = getOffsetDate(-DEFAULT_PERIOD_DAYS)
  const [{ data: completedTasks }, { data: timeEntries }] = await Promise.all([
    supabase
      .from('tasks')
      .select('title, completed_at')
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .eq('done', true)
      .gte('completed_at', `${periodStart}T00:00:00`),
    supabase.from('time_entries').select('duration_seconds').eq('org_id', orgId).eq('client_id', clientId).gte('started_at', `${periodStart}T00:00:00`),
  ])

  const completedTaskTitles = (completedTasks || []).map((t) => t.title).slice(0, 30)
  const hoursLogged = (timeEntries || []).reduce((s, e) => s + (e.duration_seconds || 0), 0) / 3600

  const prompt = buildClientUpdatePrompt({
    clientCtx: client,
    completedTaskTitles,
    hoursLogged,
    periodLabel: 'the last two weeks',
    brandVoice,
  })

  try {
    const result = await callClaude(
      apiKey,
      { model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] },
      { orgId, route: 'client-update' }
    )
    return NextResponse.json({ text: extractText(result) })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
