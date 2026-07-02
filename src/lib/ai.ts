type ClientCtx = {
  name: string
  business?: string | null
  platform?: string | null
  service?: string | null
  notes?: string | null
  tone?: string | null
  talking_points?: string | null
  last_contacted?: string | null
}

type PriorContext = {
  lastMessage?: { date: string; message: string } | null
  recentlyCompleted?: string[]
}

export async function callClaude(apiKey: string, body: Record<string, unknown>) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Anthropic API error: ${r.status}`)
  return r.json()
}

export function extractText(response: { content?: { text?: string }[] }) {
  return (response.content?.map((b) => b.text || '').join('') || '').trim()
}

function ctxLine(c: ClientCtx, prior?: PriorContext) {
  return [
    `Name: ${c.name}`,
    c.business ? `Business: ${c.business}` : '',
    c.platform ? `Platform: ${c.platform}` : '',
    c.service ? `Service: ${c.service}` : '',
    c.notes ? `Context: ${c.notes}` : '',
    c.tone ? `Tone: ${c.tone}` : '',
    c.talking_points ? `Must mention: ${c.talking_points}` : '',
    c.last_contacted ? `Last contacted: ${c.last_contacted}` : '',
    prior?.lastMessage ? `Previous message (${prior.lastMessage.date}): "${prior.lastMessage.message}"` : '',
    prior?.recentlyCompleted?.length ? `Recently completed tasks: ${prior.recentlyCompleted.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(', ')
}

export function buildDailyMessagesPrompt(clients: (ClientCtx & { priorContext?: PriorContext })[]) {
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return `You are a professional agency assistant. Today is ${dateStr}.
For each client, write a short friendly daily check-in message (3-5 sentences), ready to send as-is. Match tone to their platform. Sound human, not corporate.
Clients:
${clients.map((c, i) => `${i + 1}. ${ctxLine(c, c.priorContext)}`).join('\n')}
Return ONLY valid JSON, no markdown:
{"messages":[{"client":"name","message":"text"}]}`
}

export function buildSingleMessagePrompt(client: ClientCtx, prior: PriorContext, todaysFocus?: string) {
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const focus = todaysFocus ? `Today specifically cover: ${todaysFocus}. ` : ''
  return `Write one short friendly check-in message (3-5 sentences) for today (${dateStr}). ${focus}${ctxLine(client, prior)}. Return ONLY the message text, nothing else.`
}

export function buildWeeklyRecapPrompt(params: {
  today: string
  weekStart: string
  mrrDollars: number
  clientSummaries: string[]
}) {
  return `You are an agency operations assistant. Write a concise weekly recap (3-5 sentences) for the agency covering overall performance, who got attention, who needs attention, and any revenue notes. Be direct and actionable. No headers.

Today: ${params.today} | Week: ${params.weekStart}–${params.today} | MRR: $${params.mrrDollars}
${params.clientSummaries.join('\n')}`
}
