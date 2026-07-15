import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAndConsumeAiCredit } from '@/lib/aiCredits'
import { rateLimit } from '@/lib/rateLimit'
import { buildDailyMessagesPrompt, callClaude, extractText } from '@/lib/ai'
import { getStage, todayKey, getOffsetDate } from '@/lib/agency'

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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI generation is not configured yet' }, { status: 500 })

  // Burst guard on top of the monthly credit cap - stops a member scripting a flood of calls.
  if (!(await rateLimit(`ai:${orgId}`, 20, 60))) {
    return NextResponse.json({ error: 'Too many requests - please slow down and try again in a moment' }, { status: 429 })
  }

  const credit = await checkAndConsumeAiCredit(orgId)
  if (!credit.allowed) {
    return NextResponse.json(
      { error: `You've used all ${credit.limit} AI generations included in your ${credit.tierName} plan this month. More seats raise your monthly allowance.` },
      { status: 402 }
    )
  }

  const { data: clients } = await supabase.from('clients').select('*').eq('org_id', orgId)
  const active = (clients || []).filter((c) => getStage(c) !== 'Churned')
  if (!active.length) return NextResponse.json({ messages: [] })

  const today = todayKey()
  const cutoff = getOffsetDate(-7)
  const { data: history } = await supabase
    .from('ai_message_log')
    .select('client_id, message, created_at')
    .eq('org_id', orgId)
    .lt('created_at', today)
    .order('created_at', { ascending: false })
  const { data: recentTasks } = await supabase
    .from('tasks')
    .select('client_id, title, completed_at')
    .eq('org_id', orgId)
    .eq('done', true)
    .eq('is_auto', false)
    .gte('completed_at', cutoff)

  const clientsWithContext = active.map((c) => {
    const recentMsgs = (history || [])
      .filter((h) => h.client_id === c.id)
      .slice(0, 3)
      .map((h) => ({ date: h.created_at.slice(0, 10), message: h.message }))
    const done = (recentTasks || []).filter((t) => t.client_id === c.id).map((t) => t.title).slice(0, 5)
    return {
      name: c.name,
      business: c.business,
      platform: c.platform,
      service: c.service,
      notes: c.notes,
      tone: c.tone,
      talking_points: c.talking_points,
      last_contacted: c.last_contacted,
      priorContext: {
        recentMessages: recentMsgs,
        recentlyCompleted: done,
      },
    }
  })

  try {
    const prompt = buildDailyMessagesPrompt(clientsWithContext, brandVoice)
    const result = await callClaude(
      apiKey,
      { model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] },
      { orgId, route: 'daily-messages' }
    )
    const txt = extractText(result)
    const parsed = JSON.parse(txt.replace(/```json|```/g, '').trim())
    return NextResponse.json({ messages: parsed.messages || [] })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
