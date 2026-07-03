import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrgAnthropicKey } from '@/lib/orgSecrets'
import { buildSingleMessagePrompt, callClaude, extractText } from '@/lib/ai'
import { getOffsetDate, todayKey } from '@/lib/agency'

export async function POST(request: Request) {
  const { orgId, clientId, todaysFocus } = await request.json()
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

  const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).eq('org_id', orgId).single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const today = todayKey()
  const cutoff = getOffsetDate(-7)
  const { data: lastMsgRows } = await supabase
    .from('ai_message_log')
    .select('message, created_at')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .lt('created_at', today)
    .order('created_at', { ascending: false })
    .limit(3)
  const { data: recentTasks } = await supabase
    .from('tasks')
    .select('title')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('done', true)
    .eq('is_auto', false)
    .gte('completed_at', cutoff)
    .limit(5)

  try {
    const prompt = buildSingleMessagePrompt(
      client,
      {
        recentMessages: (lastMsgRows || []).map((m) => ({ date: m.created_at.slice(0, 10), message: m.message })),
        recentlyCompleted: (recentTasks || []).map((t) => t.title),
      },
      todaysFocus,
      brandVoice
    )
    const result = await callClaude(apiKey, { model: 'claude-sonnet-4-6', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
    return NextResponse.json({ message: extractText(result) })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
