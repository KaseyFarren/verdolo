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

export function buildTasksFromDocPrompt(params: { clientName?: string; today: string; text?: string }) {
  const clientLine = params.clientName ? ` for the client "${params.clientName}"` : ''
  const sourceLine = params.text
    ? `Source document:\n"""\n${params.text}\n"""`
    : 'A source document is attached to this message - read it directly.'
  return `You are an agency operations assistant. Read the attached meeting transcript or document${clientLine} and extract concrete, actionable follow-up tasks - things someone on the team needs to do, not general discussion points or things already done.
Today's date is ${params.today}. Only set a due_date if the source clearly implies one (e.g. "by Friday", "next week") - resolve relative dates against today's date. Otherwise leave it null. Set priority to High only for things described as urgent or blocking; default to Medium.
${sourceLine}
Return ONLY valid JSON, no markdown:
{"tasks":[{"title":"short imperative title","due_date":"YYYY-MM-DD or null","priority":"High|Medium|Low","notes":"one sentence of context from the source, or empty string"}]}
If no actionable tasks are found, return {"tasks":[]}.`
}

export function buildScopeCreepPrompt(params: {
  clientName: string
  hours: number
  revenueCents: number
  effectiveRateCents: number
  targetRateCents: number
  isEstimatedRevenue: boolean
  periodLabel: string
  currencySign?: string
  fullRetainerCents?: number
  retainerCoversTarget?: boolean
  daysRemaining?: number
  hoursBudgetAtTarget?: number
  hoursRemainingBudget?: number
  projectedFullMonthHours?: number
  projectedOverageHours?: number
  projectedOverageCents?: number
  clientCtx?: ClientCtx
  brandVoice?: string | null
}) {
  const sign = params.currencySign ?? '$'
  const revenue = (params.revenueCents / 100).toFixed(0)
  const effectiveRate = (params.effectiveRateCents / 100).toFixed(0)
  const targetRate = (params.targetRateCents / 100).toFixed(0)
  // revenueCents/hours are both matched to the same elapsed portion of the month, so
  // effectiveRateCents is a genuine current-pace signal - if hours keep coming in at this rate,
  // the full month lands at roughly the same rate, not a better one. Whether a retainer raise is
  // warranted, and how far off the current pace is, are both answered deterministically
  // server-side rather than left for the model to work out itself, since dividing the full
  // retainer by only the hours logged so far silently assumes hours stop accruing for the rest
  // of the month - a wrong assumption that produces a falsely reassuring "projected" rate.
  const retainerLine =
    params.isEstimatedRevenue && params.fullRetainerCents
      ? ` The client's full monthly retainer is ${sign}${(params.fullRetainerCents / 100).toFixed(0)} - the revenue figure above is only the portion elapsed so far this month. ${params.retainerCoversTarget ? 'That full retainer already covers what target rate would require for the hours logged so far, so a retainer increase is not warranted right now - the concern is hours pace, not contract value.' : 'Even the full retainer falls short of what target rate would require for the hours logged so far, so a retainer increase is a legitimate option.'} If hours keep being logged at the current pace for the rest of the month, the effective rate will land around the same ${sign}${effectiveRate}/hr shown above, not a better one - the rate is not simply "catching up" as the month progresses.`
      : ''
  const projectionLine =
    params.hoursBudgetAtTarget !== undefined && params.projectedFullMonthHours !== undefined
      ? ` The retainer supports about ${params.hoursBudgetAtTarget.toFixed(1)}h this month at target rate. At the current daily pace, hours are on track to reach about ${params.projectedFullMonthHours.toFixed(1)}h by the end of ${params.periodLabel}, with ${params.daysRemaining} day(s) left. ${(params.hoursRemainingBudget ?? 0) > 0 ? `That leaves about ${(params.hoursRemainingBudget ?? 0).toFixed(1)}h of budget remaining this month before hours exceed what the retainer supports.` : `Hours logged already exceed that budget by about ${Math.abs(params.hoursRemainingBudget ?? 0).toFixed(1)}h.`} If this pace continues for the rest of the month, the account is on track to run about ${(params.projectedOverageHours ?? 0).toFixed(1)}h over that budget, worth roughly ${sign}${((params.projectedOverageCents ?? 0) / 100).toFixed(0)} of time beyond what the retainer covers.`
      : ''
  const clientMessageSection = params.clientCtx
    ? `

Also write a short, ready-to-send message TO THE CLIENT proposing a capacity/scope conversation. Match this client's established tone and context: ${ctxLine(params.clientCtx)}. ${voiceLine(params.brandVoice)}Keep it collaborative and non-accusatory, framed as making sure they get the most out of the current plan - not a complaint about them. Do not mention internal target rates, £/hr figures, or margin - only hours and scope. 3-5 sentences, ready to send as-is.

Return ONLY valid JSON, no markdown:
{"note": "2-3 sentences for the account owner, internal only", "clientMessage": "the client-facing message described above"}`
    : `

Respond with 1-2 short sentences only, no headers.`
  return `You are an agency operations assistant. A client's effective hourly rate is below the team's target rate - the account is consuming more time than its revenue supports at that target.
Client: ${params.clientName}. Period: ${params.periodLabel}. Hours logged: ${params.hours.toFixed(1)}. Revenue: ${sign}${revenue}${params.isEstimatedRevenue ? ' (retainer estimate, prorated to date)' : ''}. Effective rate realized: ${sign}${effectiveRate}/hr, vs a target of ${sign}${targetRate}/hr.${retainerLine}${projectionLine}
Tell the account owner what's going on using the numbers above and suggest one concrete next step (cap hours, have a scope conversation, or raise the retainer - only raise the retainer if told above that the current one falls short). Do not independently recompute a projected or "full month" rate yourself - use only the figures given above. Be direct, no fluff. Do not use em dashes.${clientMessageSection}`
}
