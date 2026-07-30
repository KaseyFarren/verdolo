import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAndConsumeAiCredit } from '@/lib/aiCredits'
import { rateLimit } from '@/lib/rateLimit'
import { buildTaskFromMessagePrompt, callClaude, extractText } from '@/lib/ai'
import { todayKey } from '@/lib/agency'

const MAX_TEXT_CHARS = 4000

export const maxDuration = 30

export async function POST(request: Request) {
  const { orgId, text, senderName, sentAt } = await request.json()
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

  if (typeof text !== 'string' || !text.trim()) return NextResponse.json({ error: 'No message text provided' }, { status: 400 })
  if (text.length > MAX_TEXT_CHARS) return NextResponse.json({ error: 'Message is too long' }, { status: 400 })

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

  const prompt = buildTaskFromMessagePrompt({
    senderName: typeof senderName === 'string' ? senderName.slice(0, 100) : 'a teammate',
    sentAt: typeof sentAt === 'string' ? sentAt : todayKey(),
    today: todayKey(),
    text,
  })

  try {
    const result = await callClaude(
      apiKey,
      { model: 'claude-sonnet-4-6', max_tokens: 300, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] },
      { orgId, route: 'task-from-message' }
    )
    const txt = extractText(result)
    const parsed = JSON.parse(txt.replace(/```json|```/g, '').trim())
    if (typeof parsed.title !== 'string' || !parsed.title.trim()) throw new Error('no title')
    const task = {
      title: parsed.title.slice(0, 200),
      due_date: typeof parsed.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.due_date) ? parsed.due_date : null,
      priority: ['High', 'Medium', 'Low'].includes(parsed.priority) ? parsed.priority : 'Medium',
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 500) : '',
    }
    return NextResponse.json({ task })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
