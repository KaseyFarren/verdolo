'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import Button from '@/components/ui/Button'
import PeriodSelector from '@/components/ui/PeriodSelector'
import {
  AVATAR_COLORS,
  centsToDollars,
  currencySymbol,
  dollarsToCents,
  effectiveRate,
  getInitials,
  getStage,
  isRateComparisonMeaningful,
  memberName,
  mrrCentsTotal,
  todayKey,
  type Currency,
} from '@/lib/agency'
import { isFullCalendarMonth, billingCycleElapsedFraction, billingDatesInRange, periodBounds, type PeriodValue } from '@/lib/period'
import MetricBar from '@/components/ui/MetricBar'
import DatePicker from '@/components/ui/DatePicker'
import InfoTooltip from '@/components/ui/InfoTooltip'

type Client = {
  id: string
  name: string
  retainer_cents: number | null
  billing_mode: string | null
  hourly_rate_cents: number | null
  billing_day: number | null
  stage: string | null
  status: string | null
}
type Charge = { id: string; client_id: string; description: string; amount_cents: number; charged_on: string }
type Entry = { user_id: string; client_id: string | null; duration_seconds: number | null; started_at: string; billable: boolean }
type Member = { user_id: string; invited_email: string | null; display_name: string | null; avatar_url: string | null; role?: string; title?: string | null }

function Avatar({ member, index }: { member: Member; index: number }) {
  const name = memberName(member)
  if (member.avatar_url) return <img src={member.avatar_url} alt={name} className="h-8 w-8 rounded-full object-cover shrink-0" />
  return (
    <div
      className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
      style={{ background: AVATAR_COLORS[Math.abs(index) % AVATAR_COLORS.length] }}
    >
      {getInitials(name)}
    </div>
  )
}

function formatHours(seconds: number) {
  return (seconds / 3600).toFixed(1)
}

type TaskRow = { assigned_to: string; done: boolean; completed_at: string | null; original_due_date: string | null }
type ArchivedTaskTotal = { assigned_to: string; completed: number; completed_late: number }

export default function RevenueClient({
  orgId,
  period,
  today,
  clients,
  initialCharges,
  entries,
  members,
  tasks,
  archivedTaskTotals,
  targetRateCents,
  currency,
}: {
  orgId: string
  period: PeriodValue
  today: string
  clients: Client[]
  initialCharges: Charge[]
  entries: Entry[]
  members: Member[]
  tasks: TaskRow[]
  archivedTaskTotals: ArchivedTaskTotal[]
  targetRateCents: number
  currency?: Currency
}) {
  const currencySign = currencySymbol(currency)
  function fmtMoney(cents: number) {
    return `${currencySign}${centsToDollars(cents).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  }
  function formatRateDelta(centsPerHour: number) {
    const sign = centsPerHour >= 0 ? '+' : '−'
    return `${sign}${currencySign}${Math.round(Math.abs(centsPerHour) / 100).toLocaleString()}/hr`
  }
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const confirm = useConfirm()
  const [charges, setCharges] = useState<Charge[]>(initialCharges)
  // router.push to a different ?period= re-runs the server component and gives a new
  // initialCharges array, but useState's initializer only runs on mount - without this,
  // switching periods would keep showing the previous period's charges.
  useEffect(() => {
    setCharges(initialCharges)
  }, [initialCharges])
  const isFullMonth = isFullCalendarMonth(period)
  const { start: rangeStart, end: rangeEnd } = useMemo(() => periodBounds(period), [period])

  // The pill itself is driven by this local, optimistically-updated copy so it slides
  // instantly on click - the actual revenue figures below stay tied to the real `period` prop
  // until router.push's server round trip lands, same as the underlying data always has.
  const [localPeriod, setLocalPeriod] = useState(period)
  useEffect(() => {
    setLocalPeriod(period)
  }, [period])

  function pushPeriod(next: PeriodValue) {
    setLocalPeriod(next)
    const params = new URLSearchParams()
    if (next.period !== 'this_month') params.set('period', next.period)
    if (next.period === 'custom') {
      if (next.start) params.set('start', next.start)
      if (next.end) params.set('end', next.end)
    }
    const qs = params.toString()
    router.push(qs ? `/revenue?${qs}` : '/revenue')
  }
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null)
  const [chargeDesc, setChargeDesc] = useState('')
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeDate, setChargeDate] = useState(todayKey())
  const [saving, setSaving] = useState(false)

  const hoursByClient = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      if (!e.client_id || !e.duration_seconds) continue
      map.set(e.client_id, (map.get(e.client_id) || 0) + e.duration_seconds)
    }
    return map
  }, [entries])

  // Only billable hours are ever actually invoiced for an hourly client - matches the cron's
  // and the manual invoice flow's "unbilled hours" query exactly.
  const billableHoursByClient = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      if (!e.client_id || !e.duration_seconds || !e.billable) continue
      map.set(e.client_id, (map.get(e.client_id) || 0) + e.duration_seconds)
    }
    return map
  }, [entries])

  const chargesByClient = useMemo(() => {
    const map = new Map<string, Charge[]>()
    for (const c of charges) {
      const list = map.get(c.client_id) || []
      list.push(c)
      map.set(c.client_id, list)
    }
    return map
  }, [charges])

  const clientRows = useMemo(() => {
    // Days between rangeStart (inclusive) and rangeEnd (exclusive) - used only to smooth the
    // retainer for the *rate* calc below, never shown as a $ figure.
    const rangeDays = (() => {
      if (!rangeStart || !rangeEnd) return 0
      const [sy, sm, sd] = rangeStart.split('-').map(Number)
      const [ey, em, ed] = rangeEnd.split('-').map(Number)
      return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000)
    })()
    const rangeMonthDays = rangeStart ? new Date(Number(rangeStart.slice(0, 4)), Number(rangeStart.slice(5, 7)), 0).getDate() : 30
    const smoothedRetainerFraction = rangeMonthDays > 0 ? rangeDays / rangeMonthDays : 0

    return clients
      .map((c) => {
        const chargesTotal = (chargesByClient.get(c.id) || []).reduce((s, ch) => s + ch.amount_cents, 0)
        const isHourly = c.billing_mode === 'hourly'
        // hourly revenue scales with any period length, unlike a retainer - which is a monthly
        // figure, so only a full calendar month period can honestly include one; a week or
        // custom range only counts what was actually billed/logged in it
        const hourlyRevenue = isHourly ? Math.round(((billableHoursByClient.get(c.id) || 0) / 3600) * (c.hourly_rate_cents || 0)) : 0
        // A retainer is a full-cycle figure. For a full calendar month, attribute the whole thing
        // once the cycle's complete, or prorate by how far this client's own billing cycle has
        // gotten if the current month is still in progress (not assuming everyone renews on the
        // 1st). For anything narrower (a week, a custom range), a partial slice isn't a real event
        // - so instead recognize the full retainer on whichever day(s) in that range are actually
        // this client's renewal date, and nothing otherwise.
        const retainerFraction = period.period === 'this_month' ? billingCycleElapsedFraction(c.billing_day || 1) : 1
        const billingDatesThisRange = !isHourly && !isFullMonth && rangeStart && rangeEnd ? billingDatesInRange(c.billing_day || 1, rangeStart, rangeEnd) : []
        const retainerRevenue = isHourly
          ? 0
          : isFullMonth
            ? Math.round((c.retainer_cents || 0) * retainerFraction)
            : billingDatesThisRange.length * (c.retainer_cents || 0)
        const totalRevenue = retainerRevenue + hourlyRevenue + chargesTotal
        // The $ figure above is deliberately spiky (full retainer lands on its billing day, $0
        // otherwise) - accurate for "how much money actually showed up", but divided by hours it
        // would make a retainer client's rate swing from ~$0/hr to enormous depending on whether
        // the billing date happens to fall inside the selected range. The rate needs a steadier
        // proxy, so outside a full month it spreads the retainer evenly across the range instead
        // of lump-summing it - same fix Reports already applies to its weekly effective-rate line.
        const rateRetainerRevenue = isHourly
          ? 0
          : isFullMonth
            ? retainerRevenue
            : Math.round((c.retainer_cents || 0) * smoothedRetainerFraction)
        const rateRevenueCents = rateRetainerRevenue + hourlyRevenue + chargesTotal
        // "hours logged" stays every hour (billable + non-billable) regardless of billing mode,
        // consistent with the rest of this page - not swapped to billable-only for hourly rows
        const seconds = hoursByClient.get(c.id) || 0
        const hours = seconds / 3600
        const rate = effectiveRate(rateRevenueCents, hours)
        const rateDeltaCents = rate !== null && targetRateCents > 0 ? rate - targetRateCents : null
        return { client: c, isHourly, chargesTotal, totalRevenue, rateRevenueCents, seconds, hours, rate, rateDeltaCents, billedThisRange: billingDatesThisRange.length > 0 }
      })
      .filter((r) => r.totalRevenue > 0 || r.seconds > 0)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
  }, [clients, chargesByClient, hoursByClient, billableHoursByClient, isFullMonth, targetRateCents, period.period, rangeStart, rangeEnd])

  const memberRows = useMemo(() => {
    return members
      .map((m) => {
        let seconds = 0
        let revenue = 0
        for (const row of clientRows) {
          const memberSeconds = entries
            .filter((e) => e.user_id === m.user_id && e.client_id === row.client.id)
            .reduce((s, e) => s + (e.duration_seconds || 0), 0)
          seconds += memberSeconds
          if (row.rate) revenue += (memberSeconds / 3600) * row.rate
        }
        return { member: m, seconds, revenue }
      })
      .filter((r) => r.seconds > 0 || tasks.some((t) => t.assigned_to === r.member.user_id))
      .sort((a, b) => b.revenue - a.revenue)
  }, [members, clientRows, entries, tasks])

  const maxMemberSeconds = Math.max(1, ...memberRows.map((r) => r.seconds))
  const maxMemberRevenue = Math.max(1, ...memberRows.map((r) => r.revenue))

  // original_due_date is frozen at task creation (migration 0020) and never changes even if
  // due_date is edited later, so these counts can't be gamed by pushing a due date forward.
  const taskStatsByMember = useMemo(() => {
    const map = new Map<string, { completed: number; completedLate: number; overdueIncomplete: number }>()
    for (const t of tasks) {
      const stats = map.get(t.assigned_to) || { completed: 0, completedLate: 0, overdueIncomplete: 0 }
      if (t.done) {
        stats.completed++
        if (t.completed_at && t.original_due_date && t.completed_at.slice(0, 10) > t.original_due_date) stats.completedLate++
      } else if (t.original_due_date && t.original_due_date < today) {
        stats.overdueIncomplete++
      }
      map.set(t.assigned_to, stats)
    }
    // Tasks purged by the 60-day archive-cleanup cron (api/cron/archive-cleanup) no longer
    // exist as rows, but their contribution to these counters was rolled up into
    // task_archived_totals before deletion - fold it back in so old custom date ranges on
    // this page still show accurate completed/completed-late counts.
    for (const a of archivedTaskTotals) {
      const stats = map.get(a.assigned_to) || { completed: 0, completedLate: 0, overdueIncomplete: 0 }
      stats.completed += a.completed
      stats.completedLate += a.completed_late
      map.set(a.assigned_to, stats)
    }
    return map
  }, [tasks, archivedTaskTotals, today])

  const totals = useMemo(() => {
    const revenue = clientRows.reduce((s, r) => s + r.totalRevenue, 0)
    const seconds = clientRows.reduce((s, r) => s + r.seconds, 0)
    const hours = seconds / 3600
    // Blended rate uses the smoothed rateRevenueCents (see clientRows), not the spiky totalRevenue
    // - otherwise the org-wide rate would swing wildly depending on how many clients happen to bill
    // inside the selected week.
    const rateRevenue = clientRows.reduce((s, r) => s + r.rateRevenueCents, 0)
    const rate = effectiveRate(rateRevenue, hours)
    return { revenue, hours, rate, rateDeltaCents: rate !== null && targetRateCents > 0 ? rate - targetRateCents : null }
  }, [clientRows, targetRateCents])

  // MRR and at-risk exposure are current-state snapshots, not scoped to the selected period -
  // a retainer is "at risk" regardless of which week you happen to be looking at.
  const mrrCents = useMemo(() => mrrCentsTotal(clients), [clients])
  const atRiskClients = useMemo(() => clients.filter((c) => getStage(c) === 'At Risk'), [clients])
  const atRiskCents = useMemo(() => atRiskClients.reduce((s, c) => s + (c.retainer_cents || 0), 0), [atRiskClients])
  const utilization = useMemo(() => {
    const totalSeconds = entries.reduce((s, e) => s + (e.duration_seconds || 0), 0)
    const billableSeconds = entries.filter((e) => e.billable).reduce((s, e) => s + (e.duration_seconds || 0), 0)
    return totalSeconds > 0 ? (billableSeconds / totalSeconds) * 100 : null
  }, [entries])
  const topClientPct = totals.revenue > 0 && clientRows.length > 0 ? (clientRows[0].totalRevenue / totals.revenue) * 100 : null

  async function addCharge(clientId: string) {
    const cents = dollarsToCents(chargeAmount || '0')
    if (!chargeDesc.trim() || !cents) return
    setSaving(true)
    const { data, error } = await supabase
      .from('client_charges')
      .insert({ org_id: orgId, client_id: clientId, description: chargeDesc.trim(), amount_cents: cents, charged_on: chargeDate })
      .select()
      .single()
    if (data) {
      setCharges((prev) => [data as Charge, ...prev])
      toast.success('Charge added')
      setChargeDesc('')
      setChargeAmount('')
    } else if (error) {
      toast.error('Failed to add charge')
    }
    setSaving(false)
  }

  async function deleteCharge(charge: Charge) {
    const ok = await confirm({ title: `Delete "${charge.description}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    // Optimistic: drop the row immediately; restore the full prior list if the delete fails.
    let snapshot: Charge[] = []
    setCharges((prev) => {
      snapshot = prev
      return prev.filter((c) => c.id !== charge.id)
    })
    const { error } = await supabase.from('client_charges').delete().eq('id', charge.id)
    if (error) {
      setCharges(snapshot)
      toast.error('Failed to delete charge')
    }
  }

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-xl font-semibold">Revenue</h1>
      </div>
      <p className="text-xs text-sage mb-4">Retainer + extra billables, attributed to the hours logged this period. Owner-only.</p>

      <PeriodSelector
        layoutId="revenue-period-active"
        value={localPeriod}
        onChange={pushPeriod}
        presets={['this_month', 'last_month', 'this_week', 'last_week', 'custom']}
        className="mb-4"
      />
      {!isFullMonth && (
        <div className="text-xs text-sage/70 mb-5">
          Retainer clients show revenue here only on the day they renew - showing billables + hours actually logged in this range otherwise.
        </div>
      )}
      {isFullMonth && period.period === 'this_month' && (
        <div className="text-xs text-sage/70 mb-5">
          Showing partial-cycle figures - retainer revenue is prorated to date within each client&apos;s own billing cycle and will reach full value once that cycle completes.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3" data-tour="revenue-summary">
        <div className="rounded-2xl bg-white shadow-md p-5">
          <div className="text-xs text-sage mb-1">Total revenue</div>
          <div className="text-2xl font-heading font-bold">{fmtMoney(totals.revenue)}</div>
        </div>
        <div className="rounded-2xl bg-white shadow-md p-5">
          <div className="text-xs text-sage mb-1">
            MRR <InfoTooltip content="Monthly recurring revenue - sum of active clients' monthly retainers" />
          </div>
          <div className="text-2xl font-heading font-bold">{fmtMoney(mrrCents)}</div>
        </div>
        <div className="rounded-2xl bg-white shadow-md p-5">
          <div className="text-xs text-sage mb-1">Hours logged</div>
          <div className="text-2xl font-heading font-bold">{totals.hours.toFixed(1)}</div>
        </div>
        <div className="rounded-2xl bg-white shadow-md p-5">
          <div className="text-xs text-sage mb-1">
            Blended rate <InfoTooltip content="Total revenue divided by total hours logged, across all clients" />
          </div>
          <div className="text-2xl font-heading font-bold">{totals.rate ? `${currencySign}${centsToDollars(totals.rate)}/hr` : '-'}</div>
        </div>
        <div className="rounded-2xl bg-white shadow-md p-5">
          <div className="text-xs text-sage mb-1">
            vs. target rate <InfoTooltip content="Blended rate compared to the target hourly rate set in Settings → General" />
          </div>
          <div className={`text-2xl font-heading font-bold ${totals.rateDeltaCents !== null && totals.rateDeltaCents < 0 ? 'text-red-600' : ''}`}>
            {totals.rateDeltaCents !== null ? formatRateDelta(totals.rateDeltaCents) : '-'}
          </div>
        </div>
        <div className="rounded-2xl bg-white shadow-md p-5">
          <div className="text-xs text-sage mb-1">
            Billable utilization <InfoTooltip content="Share of logged hours marked billable" />
          </div>
          <div className="text-2xl font-heading font-bold">{utilization !== null ? `${utilization.toFixed(0)}%` : '-'}</div>
        </div>
      </div>
      {targetRateCents === 0 && (
        <div className="text-xs text-sage bg-white rounded-xl shadow-md p-3 mb-3">
          Verdolo doesn&apos;t track expenses, so there&apos;s no real cost/margin here - set a target hourly rate in Settings → General to
          see how your blended rate compares (no target set yet).
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-6">
        {topClientPct !== null && (
          <div className={`rounded-lg px-3 py-1.5 text-xs ${topClientPct >= 50 ? 'bg-amber-100' : 'bg-sand'}`}>
            <span className={`font-semibold ${topClientPct >= 50 ? 'text-amber-700' : ''}`}>{topClientPct.toFixed(0)}%</span>{' '}
            <span className={topClientPct >= 50 ? 'text-amber-700' : 'text-sage'}>of revenue from top client</span>
          </div>
        )}
        {atRiskCents > 0 && (
          <div className="rounded-lg px-3 py-1.5 text-xs bg-red-100 inline-flex items-center">
            <span className="font-semibold text-red-600">{fmtMoney(atRiskCents)}</span>&nbsp;<span className="text-red-600">MRR at risk</span>
            <InfoTooltip
              content={`Combined monthly retainer of ${atRiskClients.length} client${atRiskClients.length === 1 ? '' : 's'} in the At Risk stage${
                atRiskClients.length ? `: ${atRiskClients.map((c) => c.name).join(', ')}` : ''
              }. This retainer walks if they churn - reach out, then move them out of At Risk in Clients to clear it.`}
            />
          </div>
        )}
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2" data-tour="revenue-billables">By client</div>
      {clientRows.length === 0 ? (
        <div className="text-sm text-sage py-4 mb-6">No revenue or time logged this period.</div>
      ) : (
        <div className="space-y-2 mb-6">
          {clientRows.map((r) => {
            const clientCharges = chargesByClient.get(r.client.id) || []
            const expanded = expandedClientId === r.client.id
            return (
              <div
                key={r.client.id}
                className={`rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow ${expanded ? 'ring-1 ring-ink/10' : ''}`}
              >
                <button
                  className="group flex flex-wrap w-full items-center justify-between gap-y-1 text-sm text-left px-4 py-3"
                  onClick={() => setExpandedClientId(expanded ? null : r.client.id)}
                >
                  <span className="flex-1 min-w-[140px]">
                    <span className="font-medium">{r.client.name}</span>
                    {r.isHourly ? (
                      <span className="text-sage ml-2 text-xs">{currencySign}{centsToDollars(r.client.hourly_rate_cents || 0)}/hr hourly</span>
                    ) : r.client.retainer_cents ? (
                      <span className="text-sage ml-2 text-xs">{fmtMoney(r.client.retainer_cents)}/mo retainer</span>
                    ) : null}
                    {r.billedThisRange && (
                      <span
                        className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 align-middle"
                        title="Retainer renews in this period - full amount recognized on that day"
                      >
                        Billed this period
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-4 shrink-0">
                    <span className="text-sage w-14 text-right">{formatHours(r.seconds)}h</span>
                    {isRateComparisonMeaningful(r.client) ? (
                      <span className={`w-16 text-right ${r.rateDeltaCents !== null && r.rateDeltaCents < 0 ? 'text-red-600' : 'text-sage'}`}>
                        {r.rate ? `${currencySign}${centsToDollars(r.rate)}/hr` : '-'}
                      </span>
                    ) : (
                      <span className="text-sage w-16 text-right">{currencySign}{centsToDollars(r.client.hourly_rate_cents || 0)}/hr</span>
                    )}
                    <span className="font-medium w-16 text-right">{fmtMoney(r.totalRevenue)}</span>
                    <span
                      className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center transition-all ${
                        expanded ? 'bg-ink text-white rotate-180' : 'bg-sand text-sage group-hover:bg-clay/20 group-hover:text-ink'
                      }`}
                      title={expanded ? 'Hide billing details' : 'View billing details'}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </span>
                </button>
                {expanded && (
                  <div className="mx-4 pb-4 mt-1 pl-3 border-l-2 border-ink/10 space-y-2">
                    {clientCharges.length > 0 && (
                      <div className="space-y-1">
                        {clientCharges.map((c) => (
                          <div key={c.id} className="flex items-center justify-between text-xs text-sage group">
                            <span>
                              {c.description} <span className="text-ink/40">· {c.charged_on}</span>
                            </span>
                            <div className="flex items-center gap-2">
                              <span>{fmtMoney(c.amount_cents)}</span>
                              <button
                                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-red-600"
                                onClick={() => deleteCharge(c)}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded border border-ink/10 bg-white px-2 py-1.5 text-xs"
                        placeholder="What for?"
                        value={chargeDesc}
                        onChange={(e) => setChargeDesc(e.target.value)}
                      />
                      <input
                        className="w-20 rounded border border-ink/10 bg-white px-2 py-1.5 text-xs"
                        placeholder={currencySign}
                        inputMode="decimal"
                        value={chargeAmount}
                        onChange={(e) => setChargeAmount(e.target.value)}
                      />
                      <DatePicker value={chargeDate} onChange={setChargeDate} placeholder="Date" allowClear={false} className="text-xs" />
                      <Button variant="primary" className="!px-3 !py-1.5 text-xs" disabled={saving} onClick={() => addCharge(r.client.id)}>
                        Add
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">By teammate</div>
      {memberRows.length === 0 ? (
        <div className="text-sm text-sage py-4">No time logged or tasks assigned this month.</div>
      ) : (
        <div className="space-y-3">
          {memberRows.map((r, i) => {
            const stats = taskStatsByMember.get(r.member.user_id) || { completed: 0, completedLate: 0, overdueIncomplete: 0 }
            return (
              <div key={r.member.user_id} className="rounded-2xl bg-white shadow-md p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <Avatar member={r.member} index={i} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{memberName(r.member)}</div>
                    {r.member.role && (
                      <div className="text-xs text-sage capitalize">
                        {r.member.role}
                        {r.member.title && ` · ${r.member.title}`}
                      </div>
                    )}
                  </div>
                  <div className="sm:ml-auto flex gap-2 shrink-0">
                    <div className="w-28">
                      <div className="text-xs text-sage mb-1">Hours</div>
                      <MetricBar value={r.seconds} max={maxMemberSeconds} display={`${formatHours(r.seconds)}h`} />
                    </div>
                    <div className="w-28">
                      <div className="text-xs text-sage mb-1">Revenue</div>
                      <MetricBar value={r.revenue} max={maxMemberRevenue} display={fmtMoney(Math.round(r.revenue))} />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3 sm:pl-12">
                  <div className="rounded-lg bg-sand px-3 py-1.5 text-xs">
                    <span className="font-semibold">{stats.completed}</span> <span className="text-sage">completed</span>
                  </div>
                  <div className={`rounded-lg px-3 py-1.5 text-xs ${stats.overdueIncomplete > 0 ? 'bg-red-100' : 'bg-sand'}`}>
                    <span className={`font-semibold ${stats.overdueIncomplete > 0 ? 'text-red-600' : ''}`}>{stats.overdueIncomplete}</span>{' '}
                    <span className={stats.overdueIncomplete > 0 ? 'text-red-600' : 'text-sage'}>overdue</span>
                  </div>
                  <div className={`rounded-lg px-3 py-1.5 text-xs ${stats.completedLate > 0 ? 'bg-amber-100' : 'bg-sand'}`}>
                    <span className={`font-semibold ${stats.completedLate > 0 ? 'text-amber-700' : ''}`}>{stats.completedLate}</span>{' '}
                    <span className={stats.completedLate > 0 ? 'text-amber-700' : 'text-sage'}>completed late</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
