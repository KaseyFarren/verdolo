import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrgAnthropicKey } from '@/lib/orgSecrets'
import { buildWeeklyRecapPrompt, callClaude, extractText } from '@/lib/ai'
import { getHealthScore, getOffsetDate, getStage, getWeekAnchor, todayKey } from '@/lib/agency'

export async function POST(request: Request) {
  const { orgId } = await request.json()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, orgs(settings)')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not a member of this org' }, { status: 403 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brandVoice = (membership.orgs as any)?.settings?.brand_voice as string | undefined

  const apiKey = await getOrgAnthropicKey(orgId)
  if (!apiKey) return NextResponse.json({ error: 'No Anthropic API key set for this org' }, { status: 400 })

  const today = todayKey()
  const weekStart = getOffsetDate(-7)
  const [{ data: clients }, { data: messages }, { data: doneTasks }] = await Promise.all([
    supabase.from('clients').select('id, name, stage, status, cadence_days, last_contacted').eq('org_id', orgId),
    supabase.from('ai_message_log').select('client_id, created_at').eq('org_id', orgId).gte('created_at', weekStart),
    supabase.from('tasks').select('client_id').eq('org_id', orgId).eq('done', true).gte('completed_at', weekStart),
  ])

  const summaries = (clients || []).map((c) => {
    const stage = getStage(c)
    const msgCount = (messages || []).filter((m) => m.client_id === c.id).length
    const done = (doneTasks || []).filter((t) => t.client_id === c.id).length
    const health = stage === 'Churned' ? 'Churned' : getHealthScore(c.last_contacted, today, c.cadence_days || 7)
    return `- ${c.name} (${stage}): ${msgCount} msgs, ${done} tasks done, health: ${health}, last: ${c.last_contacted || 'never'}`
  })

  try {
    const prompt = buildWeeklyRecapPrompt({ today, weekStart, clientSummaries: summaries, brandVoice })
    const result = await callClaude(apiKey, { model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
    const recap = extractText(result)
    // week_start here is a stable Monday anchor for storage — distinct from the rolling
    // `weekStart` above, which is a trailing 7-day lookback used only for the stats query.
    await supabase.from('weekly_reports').upsert({ org_id: orgId, week_start: getWeekAnchor(), content: recap }, { onConflict: 'org_id,week_start' })
    return NextResponse.json({ recap })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
