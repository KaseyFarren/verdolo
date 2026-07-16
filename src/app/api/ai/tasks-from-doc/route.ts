import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAndConsumeAiCredit } from '@/lib/aiCredits'
import { rateLimit } from '@/lib/rateLimit'
import { buildTasksFromDocPrompt, callClaude, extractText } from '@/lib/ai'
import { todayKey } from '@/lib/agency'

const MAX_TEXT_CHARS = 100_000
// Vercel serverless functions cap request bodies around 4.5MB - base64 adds ~33% overhead
// on top of the raw file, so this has to stay well under that, not Anthropic's own 32MB PDF limit.
const MAX_PDF_BYTES = 3 * 1024 * 1024

type ExtractedTask = { title: string; due_date: string | null; priority: string; notes: string }

export const maxDuration = 60

export async function POST(request: Request) {
  const { orgId, clientId, text, pdfBase64 } = await request.json()
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

  if (!text && !pdfBase64) return NextResponse.json({ error: 'No document provided' }, { status: 400 })
  if (typeof text === 'string' && text.length > MAX_TEXT_CHARS) return NextResponse.json({ error: 'Document is too long' }, { status: 400 })
  // base64 is ~4/3 the size of the original file
  if (typeof pdfBase64 === 'string' && pdfBase64.length > (MAX_PDF_BYTES * 4) / 3) return NextResponse.json({ error: 'PDF is too large (20MB max)' }, { status: 400 })

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

  let clientName: string | undefined
  if (clientId) {
    const { data: client } = await supabase.from('clients').select('name').eq('id', clientId).eq('org_id', orgId).maybeSingle()
    clientName = client?.name
  }

  const prompt = buildTasksFromDocPrompt({ clientName, today: todayKey(), text: typeof text === 'string' ? text : undefined })
  const content: Record<string, unknown>[] = pdfBase64
    ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } }, { type: 'text', text: prompt }]
    : [{ type: 'text', text: prompt }]

  try {
    const result = await callClaude(
      apiKey,
      { model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content }] },
      { orgId, route: 'tasks-from-doc' }
    )
    const txt = extractText(result)
    const parsed = JSON.parse(txt.replace(/```json|```/g, '').trim())
    const tasks: ExtractedTask[] = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter((t: unknown): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as Record<string, unknown>).title === 'string')
          .map((t: Record<string, unknown>) => ({
            title: String(t.title).slice(0, 200),
            due_date: typeof t.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null,
            priority: ['High', 'Medium', 'Low'].includes(t.priority as string) ? (t.priority as string) : 'Medium',
            notes: typeof t.notes === 'string' ? t.notes.slice(0, 500) : '',
          }))
      : []
    return NextResponse.json({ tasks })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
