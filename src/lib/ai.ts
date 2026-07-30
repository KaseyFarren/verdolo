import { createAdminClient } from '@/lib/supabase/admin'

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

// $ per 1M tokens. Numerically identical to micros-per-token, which is what cost_micros wants -
// see the migration comment. Keep in sync with the model strings actually used in src/app/api/ai/*.
const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
}

// Fire-and-forget would risk the insert getting cut off when the serverless function returns,
// so this is awaited - but errors are swallowed so a logging hiccup never fails a generation
// the org already spent a credit on.
async function logAiUsage(params: { orgId: string; route: string; model: string; usage?: { input_tokens?: number; output_tokens?: number } }) {
  try {
    const inputTokens = params.usage?.input_tokens ?? 0
    const outputTokens = params.usage?.output_tokens ?? 0
    const pricing = MODEL_PRICING_PER_MTOK[params.model]
    const costMicros = pricing ? Math.round(inputTokens * pricing.input + outputTokens * pricing.output) : null
    const admin = createAdminClient()
    const { error } = await admin.from('ai_usage_log').insert({
      org_id: params.orgId,
      route: params.route,
      model: params.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_micros: costMicros,
    })
    if (error) console.error('ai_usage_log insert failed:', error)
  } catch (e) {
    console.error('ai_usage_log logging error:', e)
  }
}

export async function callClaude(
  apiKey: string,
  body: Record<string, unknown>,
  log?: { orgId: string; route: string }
) {
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
  const json = await r.json()
  if (log) {
    await logAiUsage({ orgId: log.orgId, route: log.route, model: body.model as string, usage: json.usage })
  }
  return json
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
  today: string
  clientSummaries: string[]
  brandVoice?: string | null
}) {
  const periodLabel = params.periodType === 'week' ? 'Week' : 'Month'
  // periodEnd is exclusive and can land in the future (e.g. a week generated on Tuesday still
  // spans Monday-Sunday) - the data below only reflects activity through `today`, so the AI
  // needs to know that to avoid describing a still-in-progress period as complete.
  const isInProgress = params.today >= params.periodStart && params.today < params.periodEnd
  const progressLine = isInProgress
    ? `Today is ${params.today}. This ${params.periodType} isn't over yet - the activity below only covers ${params.periodStart} through today, not the full ${params.periodType}. Write the recap as progress "so far", not as a completed-period summary.`
    : `This ${params.periodType} is complete - the activity below covers the full period.`
  return `You are an agency operations assistant. Write a concise ${params.periodType}ly recap (3-5 sentences) for the agency covering overall performance, who got attention, and who needs attention. Be direct and actionable. No headers. Do not use em dashes.
${voiceLine(params.brandVoice)}
${periodLabel}: ${params.periodStart}–${params.periodEnd}
${progressLine}
${params.clientSummaries.join('\n')}`
}

const VTT_TIMESTAMP_RANGE_RE = /^\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/
const CUE_NUMBER_ONLY_RE = /^\d+$/

// Zoom/Teams transcripts (pasted or uploaded as .vtt/.srt) carry a WEBVTT header, NOTE blocks,
// standalone cue-number lines, and "HH:MM:SS.mmm --> HH:MM:SS.mmm" timestamp lines interleaved
// with the actual spoken text. Strip just that noise, line by line, so normal prose (which never
// matches these patterns) passes through untouched.
export function stripTranscriptNoise(text: string): string {
  const lines = text.split('\n')
  const kept: string[] = []
  let inNoteBlock = false
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (inNoteBlock) {
      if (trimmed === '') inNoteBlock = false
      return
    }
    if (i === 0 && /^WEBVTT\b/i.test(trimmed)) return
    if (/^NOTE\b/i.test(trimmed)) {
      inNoteBlock = true
      return
    }
    if (VTT_TIMESTAMP_RANGE_RE.test(trimmed)) return
    if (CUE_NUMBER_ONLY_RE.test(trimmed)) return
    kept.push(line)
  })
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
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

export function buildTaskFromMessagePrompt(params: { senderName: string; sentAt: string; today: string; text: string }) {
  return `You are an agency operations assistant. A team member wants to turn one chat message into a task. Rewrite it as a single actionable task.
Message from ${params.senderName}, sent ${params.sentAt}: """${params.text}"""
Today's date is ${params.today}. Only set a due_date if the message clearly implies one (e.g. "by Friday", "next week") - resolve relative dates against the message's send date, not today. Otherwise leave it null. Set priority to High only if the message describes something urgent or blocking; default to Medium.
Return ONLY valid JSON, no markdown:
{"title":"short imperative title","due_date":"YYYY-MM-DD or null","priority":"High|Medium|Low","notes":"one sentence of context from the message, or empty string"}`
}

export type RiskSignals = {
  name: string
  contactOverdueDays: number | null
  contractEndsInDays: number | null
  overdueTaskCount: number
  manuallyFlagged: boolean
  stalled: boolean
}

export function buildRiskScanPrompt(clients: RiskSignals[]) {
  const lines = clients.map((c, i) => {
    const facts = [
      c.manuallyFlagged ? 'manually marked At Risk' : '',
      c.contactOverdueDays !== null ? `${c.contactOverdueDays} day(s) overdue for a check-in` : '',
      c.contractEndsInDays !== null
        ? c.contractEndsInDays < 0
          ? `contract already ended ${Math.abs(c.contractEndsInDays)} day(s) ago`
          : `contract ends in ${c.contractEndsInDays} day(s)`
        : '',
      c.overdueTaskCount > 0 ? `${c.overdueTaskCount} overdue task(s)` : '',
      c.stalled ? 'no completed tasks or logged hours in the last 14 days' : '',
    ].filter(Boolean)
    return `${i + 1}. ${c.name}: ${facts.join('; ')}`
  })
  return `You are an agency operations assistant. Below are clients that already have at least one deterministic warning sign - your job is to rank them by how urgently they need attention and explain why in plain language, not to invent new signs or recompute the numbers given. No dollar amounts are given here, only days and task counts - do not estimate dollar figures. Do not use em dashes.
Clients (numbered):
${lines.join('\n')}
For each client, set riskLevel to "high" if multiple signs stack up or a sign is severe (e.g. contract already ended, more than 14 days overdue for contact), otherwise "medium". Write a one-sentence plain-language reason using only the facts given, and one concrete next action (e.g. "send a check-in message", "have a scope conversation", "confirm renewal before the contract lapses"). Include every client listed above exactly once, identified by its number. Order the array most urgent first.
Return ONLY valid JSON, no markdown:
{"clients":[{"index":1,"riskLevel":"high|medium","reason":"...","action":"..."}]}`
}

export function buildClientUpdatePrompt(params: {
  clientCtx: ClientCtx
  completedTaskTitles: string[]
  hoursLogged: number
  periodLabel: string
  brandVoice?: string | null
}) {
  const workLine = params.completedTaskTitles.length
    ? `Work completed this period: ${params.completedTaskTitles.join('; ')}.`
    : 'No specific completed tasks are on record for this period - write generally about ongoing work instead.'
  const hoursLine = params.hoursLogged > 0 ? ` About ${params.hoursLogged.toFixed(1)} hours of work were logged.` : ''
  return `You are an agency operations assistant writing a status update TO SEND DIRECTLY TO THE CLIENT (not an internal note). Write 4-6 warm, specific sentences summarizing progress over ${params.periodLabel}, ready to send as-is. Match this client's established tone: ${ctxLine(params.clientCtx)}. ${voiceLine(params.brandVoice)}Do not mention internal figures like hours, rates, or money - focus only on the work and outcomes.${workLine}${hoursLine}
Do not use em dashes. Return ONLY the message text, nothing else.`
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
  burnPercent?: number | null
  projectedBurnPercent?: number | null
  drivers?: { title: string; hours: number; share: number }[]
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
  const burnLine =
    params.burnPercent !== undefined && params.burnPercent !== null
      ? ` Retainer burn: ${params.burnPercent.toFixed(0)}% of this month's hour budget used so far${
          params.projectedBurnPercent !== undefined && params.projectedBurnPercent !== null
            ? `, projected to reach ${params.projectedBurnPercent.toFixed(0)}% by month end at the current pace`
            : ''
        }.`
      : ''
  // Concentration is the signal that separates a known one-off from real scope creep: hours
  // piled onto one or two named tasks reads as a push to confirm, not a pattern; hours spread
  // thin across many small items reads as creep. Handed to the model as the finished breakdown
  // (see burnDrivers in lib/burn.ts) rather than left as arithmetic it has to get right itself,
  // same discipline as the other deterministic figures above.
  const driversLine =
    params.drivers && params.drivers.length
      ? ` Hours this month broke down as: ${params.drivers.map((d) => `${d.title} ${d.hours.toFixed(1)}h (${Math.round(d.share * 100)}%)`).join(', ')}. If one or two items make up most of that time, treat this as a possible known push to confirm with the account owner rather than asserting scope creep; if it is spread thin across many small items, that is the creep pattern.`
      : ''
  const clientMessageSection = params.clientCtx
    ? `

Also write a short, ready-to-send message TO THE CLIENT proposing a capacity/scope conversation. Match this client's established tone and context: ${ctxLine(params.clientCtx)}. ${voiceLine(params.brandVoice)}Keep it collaborative and non-accusatory, framed as making sure they get the most out of the current plan - not a complaint about them. Do not mention internal target rates, £/hr figures, or margin - only hours and scope. 3-5 sentences, ready to send as-is.

Return ONLY valid JSON, no markdown:
{"note": "2-3 sentences for the account owner, internal only", "clientMessage": "the client-facing message described above"}`
    : `

Respond with 1-2 short sentences only, no headers.`
  return `You are an agency operations assistant. A client's effective hourly rate is below the team's target rate - the account is consuming more time than its revenue supports at that target.
Client: ${params.clientName}. Period: ${params.periodLabel}. Hours logged: ${params.hours.toFixed(1)}. Revenue: ${sign}${revenue}${params.isEstimatedRevenue ? ' (retainer estimate, prorated to date)' : ''}. Effective rate realized: ${sign}${effectiveRate}/hr, vs a target of ${sign}${targetRate}/hr.${retainerLine}${projectionLine}${burnLine}${driversLine}
Tell the account owner what's going on using the numbers above and suggest one concrete next step (cap hours, have a scope conversation, or raise the retainer - only raise the retainer if told above that the current one falls short). Do not independently recompute a projected or "full month" rate yourself - use only the figures given above. Be direct, no fluff. Do not use em dashes.${clientMessageSection}`
}
