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
  const text = (response.content?.map((b) => b.text || '').join('') || '').trim()
  // Models slip past the "do not use em dashes" prompt instruction often enough that this
  // needs a hard guarantee, not just an ask - the user wants hyphens only, never em dashes.
  return text.replace(/\s*—\s*/g, ' - ')
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
  return brandVoice?.trim() ? `Brand voice - write in this voice: ${brandVoice.trim()}\n` : ''
}

export function buildDailyMessagesPrompt(clients: (ClientCtx & { priorContext?: PriorContext })[], brandVoice?: string | null) {
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return `You are a professional agency assistant. Today is ${dateStr}.
${voiceLine(brandVoice)}For each client, write a short friendly daily check-in message (3-5 sentences), ready to send as-is. Match tone to their platform. Sound human, not corporate. Do not use em dashes.
Clients:
${clients.map((c, i) => `${i + 1}. ${ctxLine(c, c.priorContext)}`).join('\n')}
Return ONLY valid JSON, no markdown:
{"messages":[{"client":"name","message":"text"}]}`
}

export function buildSingleMessagePrompt(client: ClientCtx, prior: PriorContext, todaysFocus?: string, brandVoice?: string | null) {
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const focus = todaysFocus ? `Today specifically cover: ${todaysFocus}. ` : ''
  return `Write one short friendly check-in message (3-5 sentences) for today (${dateStr}). ${voiceLine(brandVoice)}${focus}${ctxLine(client, prior)}. Do not use em dashes. Return ONLY the message text, nothing else.`
}

export function buildRecapPrompt(params: {
  periodType: 'week' | 'month'
  periodStart: string
  periodEnd: string
  clientSummaries: string[]
  brandVoice?: string | null
}) {
  const periodLabel = params.periodType === 'week' ? 'Week' : 'Month'
  return `You are an agency operations assistant. Write a concise ${params.periodType}ly recap (3-5 sentences) for the agency covering overall performance, who got attention, and who needs attention. Be direct and actionable. No headers. Do not use em dashes.
${voiceLine(params.brandVoice)}
${periodLabel}: ${params.periodStart}–${params.periodEnd}
${params.clientSummaries.join('\n')}`
}

export function buildScopeCreepPrompt(params: {
  clientName: string
  hours: number
  revenueCents: number
  effectiveRateCents: number
  targetRateCents: number
  isEstimatedRevenue: boolean
  periodLabel: string
}) {
  const revenue = (params.revenueCents / 100).toFixed(0)
  const effectiveRate = (params.effectiveRateCents / 100).toFixed(0)
  const targetRate = (params.targetRateCents / 100).toFixed(0)
  return `You are an agency operations assistant. A client's effective hourly rate is below the team's target rate - the account is consuming more time than its revenue supports at that target.
Client: ${params.clientName}. Period: ${params.periodLabel}. Hours logged: ${params.hours.toFixed(1)}. Revenue: $${revenue}${params.isEstimatedRevenue ? ' (retainer estimate)' : ''}. Effective rate realized: $${effectiveRate}/hr, vs a target of $${targetRate}/hr.
In 1-2 short sentences, tell the account owner what's going on and suggest one concrete next step (e.g. raise the retainer, cap hours, or have a scope conversation). Be direct, no fluff, no headers. Do not use em dashes.`
}
