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
  recentMessages?: { date: string; message: string }[]
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
    prior?.recentMessages?.length
      ? `Recent messages sent: ${prior.recentMessages.map((m) => `(${m.date}) "${m.message}"`).join('; ')}`
      : '',
    prior?.recentlyCompleted?.length ? `Recently completed tasks: ${prior.recentlyCompleted.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(', ')
}

function voiceLine(brandVoice?: string | null) {
  return brandVoice?.trim() ? `Brand voice — write in this voice: ${brandVoice.trim()}\n` : ''
}

export function buildDailyMessagesPrompt(clients: (ClientCtx & { priorContext?: PriorContext })[], brandVoice?: string | null) {
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return `You are a professional agency assistant. Today is ${dateStr}.
${voiceLine(brandVoice)}For each client, write a short friendly daily check-in message (3-5 sentences), ready to send as-is. Match tone to their platform. Sound human, not corporate.
Clients:
${clients.map((c, i) => `${i + 1}. ${ctxLine(c, c.priorContext)}`).join('\n')}
Return ONLY valid JSON, no markdown:
{"messages":[{"client":"name","message":"text"}]}`
}

export function buildSingleMessagePrompt(client: ClientCtx, prior: PriorContext, todaysFocus?: string, brandVoice?: string | null) {
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const focus = todaysFocus ? `Today specifically cover: ${todaysFocus}. ` : ''
  return `Write one short friendly check-in message (3-5 sentences) for today (${dateStr}). ${voiceLine(brandVoice)}${focus}${ctxLine(client, prior)}. Return ONLY the message text, nothing else.`
}

export function buildWeeklyRecapPrompt(params: {
  today: string
  weekStart: string
  clientSummaries: string[]
  brandVoice?: string | null
}) {
  return `You are an agency operations assistant. Write a concise weekly recap (3-5 sentences) for the agency covering overall performance, who got attention, and who needs attention. Be direct and actionable. No headers.
${voiceLine(params.brandVoice)}
Today: ${params.today} | Week: ${params.weekStart}–${params.today}
${params.clientSummaries.join('\n')}`
}

export function buildScopeCreepPrompt(params: { clientName: string; hours: number; revenueCents: number; costCents: number; isEstimatedRevenue: boolean }) {
  const revenue = (params.revenueCents / 100).toFixed(0)
  const cost = (params.costCents / 100).toFixed(0)
  return `You are an agency operations assistant. A client is costing more in delivered hours than they're paying for this month.
Client: ${params.clientName}. Hours logged this month: ${params.hours.toFixed(1)}. Revenue this month: $${revenue}${params.isEstimatedRevenue ? ' (retainer estimate)' : ''}. Cost of hours delivered: $${cost}.
In 1-2 short sentences, tell the account owner what's going on and suggest one concrete next step (e.g. raise the retainer, cap hours, or have a scope conversation). Be direct, no fluff, no headers.`
}
