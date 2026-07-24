import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAndConsumeAiCredit } from '@/lib/aiCredits'
import { rateLimit } from '@/lib/rateLimit'
import { buildRiskScanPrompt, callClaude, extractText, type RiskSignals } from '@/lib/ai'
import { getStage, getHealthScore, currencySymbol, todayKey, getOffsetDate } from '@/lib/agency'

export const maxDuration = 60

type ScannedClient = { clientId: string; name: string; riskLevel: 'high' | 'medium'; reason: string; action: string }

export async function POST(request: Request) {
  const { orgId } = await request.json()
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

  if (!(await rateLimit(`ai:${orgId}`, 20, 60))) {
    return NextResponse.json({ error: 'Too many requests - please slow down and try again in a moment' }, { status: 429 })
  }

  const [{ data: org }, { data: clients }, { data: tasks }, { data: timeEntries }] = await Promise.all([
    supabase.from('orgs').select('settings').eq('id', orgId).maybeSingle(),
    supabase
      .from('clients')
      .select('id, name, stage, status, last_contacted, cadence_days, contract_ends')
      .eq('org_id', orgId),
    supabase.from('tasks').select('client_id, due_date, done, archived').eq('org_id', orgId).eq('done', false).eq('archived', false),
    supabase.from('time_entries').select('client_id, duration_seconds, billable, invoice_id').eq('org_id', orgId).is('invoice_id', null).eq('billable', true),
  ])

  const today = todayKey()
  const fourteenDaysAgo = getOffsetDate(-14)

  const { data: recentTasks } = await supabase
    .from('tasks')
    .select('client_id, done, completed_at')
    .eq('org_id', orgId)
    .eq('done', true)
    .gte('completed_at', `${fourteenDaysAgo}T00:00:00`)
  const { data: recentTime } = await supabase
    .from('time_entries')
    .select('client_id, started_at')
    .eq('org_id', orgId)
    .gte('started_at', `${fourteenDaysAgo}T00:00:00`)

  const activeClients = (clients || []).filter((c) => getStage(c) !== 'Churned')

  const signalsByClient = new Map<string, RiskSignals>()
  for (const c of activeClients) {
    const health = getHealthScore(c.last_contacted, today, c.cadence_days || 7)
    const overdueDays = c.last_contacted ? daysBetween(c.last_contacted, today) : null
    const contractDays = c.contract_ends ? daysBetween(today, c.contract_ends) : null
    const overdueTaskCount = (tasks || []).filter((t) => t.client_id === c.id && t.due_date && t.due_date < today).length
    const unbilledSeconds = (timeEntries || []).filter((e) => e.client_id === c.id).reduce((s, e) => s + (e.duration_seconds || 0), 0)
    const hasRecentActivity =
      (recentTasks || []).some((t) => t.client_id === c.id) || (recentTime || []).some((e) => e.client_id === c.id)

    const signals: RiskSignals = {
      name: c.name,
      contactOverdueDays: health === 'red' ? overdueDays : null,
      contractEndsInDays: contractDays !== null && contractDays <= 30 ? contractDays : null,
      overdueTaskCount,
      manuallyFlagged: getStage(c) === 'At Risk',
      unbilledHours: unbilledSeconds / 3600,
      stalled: !hasRecentActivity,
    }

    const hasSignal =
      signals.contactOverdueDays !== null ||
      signals.contractEndsInDays !== null ||
      signals.overdueTaskCount > 0 ||
      signals.manuallyFlagged ||
      signals.unbilledHours >= 1 ||
      signals.stalled

    if (hasSignal) signalsByClient.set(c.id, signals)
  }

  if (signalsByClient.size === 0) return NextResponse.json({ clients: [] })

  const credit = await checkAndConsumeAiCredit(orgId)
  if (!credit.allowed) {
    return NextResponse.json(
      { error: `You've used all ${credit.limit} AI generations included in your ${credit.tierName} plan this month. More seats raise your monthly allowance.` },
      { status: 402 }
    )
  }

  // Ordered in lockstep so the model's 1-based "index" (matching its numbered prompt list) maps
  // back to a real clientId server-side - safer than matching on name, which isn't unique.
  const orderedIds: string[] = []
  const signalsList: RiskSignals[] = []
  for (const [id, s] of signalsByClient) {
    orderedIds.push(id)
    signalsList.push(s)
  }

  const currencySign = currencySymbol((org?.settings as { currency?: string } | null)?.currency)
  const prompt = buildRiskScanPrompt(signalsList, currencySign)

  try {
    const result = await callClaude(
      apiKey,
      { model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] },
      { orgId, route: 'risk-scan' }
    )
    const txt = extractText(result)
    const parsed = JSON.parse(txt.replace(/```json|```/g, '').trim())
    const out: ScannedClient[] = Array.isArray(parsed.clients)
      ? parsed.clients
          .filter((c: unknown): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as Record<string, unknown>).index === 'number')
          .map((c: Record<string, unknown>) => {
            const idx = (c.index as number) - 1
            const clientId = orderedIds[idx]
            if (!clientId) return null
            return {
              clientId,
              name: signalsList[idx].name.slice(0, 200),
              riskLevel: c.riskLevel === 'high' ? 'high' : 'medium',
              reason: typeof c.reason === 'string' ? c.reason.slice(0, 300) : '',
              action: typeof c.action === 'string' ? c.action.slice(0, 200) : '',
            }
          })
          .filter((c: ScannedClient | null): c is ScannedClient => c !== null)
      : []
    return NextResponse.json({ clients: out })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}

function daysBetween(fromIso: string, toIso: string) {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}
