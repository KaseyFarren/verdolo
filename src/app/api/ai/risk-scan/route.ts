import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAndConsumeAiCredit, getAiCreditStatus } from '@/lib/aiCredits'
import { rateLimit } from '@/lib/rateLimit'
import { isAdminRole, type Role } from '@/lib/org'
import { buildRiskScanPrompt, callClaude, extractText, type RiskSignals } from '@/lib/ai'
import { getStage, getHealthScore, currencySymbol, todayKey, getOffsetDate } from '@/lib/agency'

export const maxDuration = 60

// A few hours is stale enough to skip re-spending an AI credit (and a Claude round trip) on every
// dashboard visit, but short enough that a genuinely new problem (a task going overdue, a contract
// clock ticking down) surfaces again well within the same day.
const RISK_SCAN_CACHE_SECONDS = 4 * 60 * 60

type ScannedClient = { clientId: string; name: string; riskLevel: 'high' | 'medium'; reason: string; action: string }

class CreditDeniedError extends Error {}

function daysBetween(fromIso: string, toIso: string) {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

// unstable_cache's result is shared across whichever admin/owner request produces a cache miss,
// so - like Reports' getCachedReportsData - this can't use the caller's RLS-scoped client (that
// would leak one member's row-level-restricted view to every other admin/owner of the org for the
// life of the cache entry). It uses the service-role client instead and re-implements the
// authorization filter explicitly: every query below is scoped with .eq('org_id', orgId), and the
// route itself already gates entry on isAdminRole before this is ever called.
function getCachedRiskScan(orgId: string, apiKey: string) {
  return unstable_cache(
    async () => {
      const admin = createAdminClient()
      const [{ data: org }, { data: clients }, { data: tasks }, { data: timeEntries }] = await Promise.all([
        admin.from('orgs').select('settings').eq('id', orgId).maybeSingle(),
        admin.from('clients').select('id, name, stage, status, last_contacted, cadence_days, contract_ends').eq('org_id', orgId),
        admin.from('tasks').select('client_id, due_date, done, archived').eq('org_id', orgId).eq('done', false).eq('archived', false),
        admin.from('time_entries').select('client_id, duration_seconds, billable, invoice_id').eq('org_id', orgId).is('invoice_id', null).eq('billable', true),
      ])

      const today = todayKey()
      const fourteenDaysAgo = getOffsetDate(-14)

      const [{ data: recentTasks }, { data: recentTime }] = await Promise.all([
        admin.from('tasks').select('client_id, done, completed_at').eq('org_id', orgId).eq('done', true).gte('completed_at', `${fourteenDaysAgo}T00:00:00`),
        admin.from('time_entries').select('client_id, started_at').eq('org_id', orgId).gte('started_at', `${fourteenDaysAgo}T00:00:00`),
      ])

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

      if (signalsByClient.size === 0) return { clients: [] as ScannedClient[], generatedAt: new Date().toISOString() }

      // Only reached on a true cache miss - unstable_cache doesn't re-invoke this function (and
      // therefore doesn't re-spend a credit or re-call Claude) for repeat requests within the
      // revalidate window. A thrown error is never cached, so a denied credit or a failed Claude
      // call both correctly retry on the next request rather than getting stuck for the full window.
      const credit = await checkAndConsumeAiCredit(orgId)
      if (!credit.allowed) throw new CreditDeniedError()

      // Ordered in lockstep so the model's 1-based "index" (matching its numbered prompt list)
      // maps back to a real clientId server-side - safer than matching on name, which isn't unique.
      const orderedIds: string[] = []
      const signalsList: RiskSignals[] = []
      for (const [id, s] of signalsByClient) {
        orderedIds.push(id)
        signalsList.push(s)
      }

      const currencySign = currencySymbol((org?.settings as { currency?: string } | null)?.currency)
      const prompt = buildRiskScanPrompt(signalsList, currencySign)

      const result = await callClaude(
        apiKey,
        { model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] },
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
      return { clients: out, generatedAt: new Date().toISOString() }
    },
    ['risk-scan', orgId],
    { revalidate: RISK_SCAN_CACHE_SECONDS, tags: [`risk-scan:${orgId}`] }
  )()
}

export async function POST(request: Request) {
  const { orgId } = await request.json()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not a member of this org' }, { status: 403 })
  if (!isAdminRole(membership.role as Role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI generation is not configured yet' }, { status: 500 })

  if (!(await rateLimit(`ai:${orgId}`, 20, 60))) {
    return NextResponse.json({ error: 'Too many requests - please slow down and try again in a moment' }, { status: 429 })
  }

  try {
    const data = await getCachedRiskScan(orgId, apiKey)
    return NextResponse.json(data)
  } catch (e) {
    if (e instanceof CreditDeniedError) {
      const credit = await getAiCreditStatus(orgId)
      return NextResponse.json(
        { error: `You've used all ${credit.limit} AI generations included in your ${credit.tierName} plan this month. More seats raise your monthly allowance.` },
        { status: 402 }
      )
    }
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
