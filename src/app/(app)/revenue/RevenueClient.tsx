'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import PeriodSelector from '@/components/ui/PeriodSelector'
import {
  AVATAR_COLORS,
  centsToDollars,
  currencySymbol,
  dollarsToCents,
  effectiveRate,
  getInitials,
  getStage,
  memberName,
  mrrCentsTotal,
  todayKey,
  type Currency,
} from '@/lib/agency'
import {
  billingCycleProgress,
  daysUntilRenewal,
  periodBounds,
  clientExistedBy,
  clientChurnedBefore,
  smoothedRetainerRevenueCents,
  type PeriodValue,
} from '@/lib/period'
import { computeClientBurn, burnDrivers, type BurnDriver } from '@/lib/burn'
import { AlertTriangleIcon, XIcon } from '@/components/ui/icons'
import DatePicker from '@/components/ui/DatePicker'
import InfoTooltip from '@/components/ui/InfoTooltip'

type Client = {
  id: string
  name: string
  retainer_cents: number | null
  retainer_hours: number | null
  billing_mode: string | null
  hourly_rate_cents: number | null
  billing_day: number | null
  stage: string | null
  status: string | null
  added_date: string | null
  churned_at: string | null
}
type Charge = { id: string; client_id: string; description: string; amount_cents: number; charged_on: string }
type Entry = { id: string; user_id: string; client_id: string | null; duration_seconds: number | null; started_at: string; billable: boolean }
type CycleEntry = { client_id: string | null; task_id: string | null; duration_seconds: number | null; started_at: string }
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

// A stat with a thin share-of-team indicator underneath, rather than the old full-height
// filled pill - that pattern went visually dead (an inert beige lozenge) whenever the value
// was 0, which is the common case for a teammate with no hours logged yet.
function StatMeter({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="text-right min-w-[72px]">
      <div className="text-xs text-sage mb-1">{label}</div>
      <div className="text-sm font-semibold text-ink whitespace-nowrap">{display}</div>
      <div className="h-1 rounded-full bg-sand overflow-hidden mt-1.5">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
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
  cycleEntries,
  taskTitles,
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
  cycleEntries: CycleEntry[]
  taskTitles: Record<string, string>
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
  // clients/entries are mirrored into local state (same reasoning as charges above) so realtime
  // updates from other pages/teammates - a new time entry, a retainer change - can patch them in
  // without waiting for a manual refresh.
  const [clientsState, setClientsState] = useState<Client[]>(clients)
  useEffect(() => {
    setClientsState(clients)
  }, [clients])
  const [entriesState, setEntriesState] = useState<Entry[]>(entries)
  useEffect(() => {
    setEntriesState(entries)
  }, [entries])
  const { start: rangeStart, end: rangeEnd } = useMemo(() => periodBounds(period), [period])

  // Live-sync revenue inputs so this page never needs a manual refresh: a retainer/billing-mode
  // edit on Clients, a new/edited/deleted time entry on Time, or a charge added from another
  // session all flow straight into the figures above. time_entries/client_charges inserts are
  // filtered client-side to the selected period's range since Postgres Changes filters only
  // support equality, not range comparisons.
  useEffect(() => {
    const inRange = (dateOrTimestamp: string) => (!rangeStart || dateOrTimestamp >= rangeStart) && (!rangeEnd || dateOrTimestamp < rangeEnd)

    const channel = supabase
      .channel(`revenue-org-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clients', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Client
        setClientsState((prev) => (prev.some((c) => c.id === incoming.id) ? prev : [...prev, incoming]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clients', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Client
        setClientsState((prev) => prev.map((c) => (c.id === incoming.id ? incoming : c)))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'clients', filter: `org_id=eq.${orgId}` }, (payload) => {
        const old = payload.old as { id: string }
        setClientsState((prev) => prev.filter((c) => c.id !== old.id))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_entries', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Entry
        if (!inRange(incoming.started_at)) return
        setEntriesState((prev) => (prev.some((e) => e.id === incoming.id) ? prev : [...prev, incoming]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'time_entries', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Entry
        setEntriesState((prev) => {
          const exists = prev.some((e) => e.id === incoming.id)
          if (!inRange(incoming.started_at)) return exists ? prev.filter((e) => e.id !== incoming.id) : prev
          return exists ? prev.map((e) => (e.id === incoming.id ? incoming : e)) : [...prev, incoming]
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'time_entries', filter: `org_id=eq.${orgId}` }, (payload) => {
        const old = payload.old as { id: string }
        setEntriesState((prev) => prev.filter((e) => e.id !== old.id))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'client_charges', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Charge
        if (!inRange(incoming.charged_on)) return
        setCharges((prev) => (prev.some((c) => c.id === incoming.id) ? prev : [incoming, ...prev]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'client_charges', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Charge
        setCharges((prev) => {
          const exists = prev.some((c) => c.id === incoming.id)
          if (!inRange(incoming.charged_on)) return exists ? prev.filter((c) => c.id !== incoming.id) : prev
          return exists ? prev.map((c) => (c.id === incoming.id ? incoming : c)) : [incoming, ...prev]
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'client_charges', filter: `org_id=eq.${orgId}` }, (payload) => {
        const old = payload.old as { id: string }
        setCharges((prev) => prev.filter((c) => c.id !== old.id))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId, supabase, rangeStart, rangeEnd])

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
    for (const e of entriesState) {
      if (!e.client_id || !e.duration_seconds) continue
      map.set(e.client_id, (map.get(e.client_id) || 0) + e.duration_seconds)
    }
    return map
  }, [entriesState])

  // Only billable hours are ever actually invoiced for an hourly client - matches the cron's
  // and the manual invoice flow's "unbilled hours" query exactly.
  const billableHoursByClient = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entriesState) {
      if (!e.client_id || !e.duration_seconds || !e.billable) continue
      map.set(e.client_id, (map.get(e.client_id) || 0) + e.duration_seconds)
    }
    return map
  }, [entriesState])

  const chargesByClient = useMemo(() => {
    const map = new Map<string, Charge[]>()
    for (const c of charges) {
      const list = map.get(c.client_id) || []
      list.push(c)
      map.set(c.client_id, list)
    }
    return map
  }, [charges])

  const taskTitleMap = useMemo(() => new Map(Object.entries(taskTitles)), [taskTitles])

  const clientRows = useMemo(() => {
    // Exclude a client from a range that falls entirely before they were added - otherwise a
    // custom/past range would still show their current retainer as if it always applied, same
    // fix as Reports' profitabilityForMonth/Week. A range entirely after they churned is NOT
    // excluded here (see churnedByThisRange below, gating only the ongoing retainer/hourly
    // portion) - a charge billed after they left is still real revenue for that range.
    return clientsState
      .filter((c) => clientExistedBy(c, rangeEnd))
      .map((c) => {
        const chargesTotal = (chargesByClient.get(c.id) || []).reduce((s, ch) => s + ch.amount_cents, 0)
        const isHourly = c.billing_mode === 'hourly'
        const churnedByThisRange = clientChurnedBefore(c, rangeStart)
        const billableSeconds = billableHoursByClient.get(c.id) || 0
        const hourlyRevenue = isHourly && !churnedByThisRange ? Math.round((billableSeconds / 3600) * (c.hourly_rate_cents || 0)) : 0
        // A retainer's fair share of the selected range, a day at a time - day 1 of the month is
        // worth 1/daysInMonth, and so on. Same formula everywhere revenue gets attributed
        // (Reports, Dashboard, here) - no billing-day-specific cliff to explain or disagree on.
        const retainerRevenue =
          isHourly || churnedByThisRange || !rangeStart || !rangeEnd ? 0 : smoothedRetainerRevenueCents(c.retainer_cents || 0, rangeStart, rangeEnd)
        const totalRevenue = retainerRevenue + hourlyRevenue + chargesTotal
        // "hours logged" stays every hour (billable + non-billable) regardless of billing mode,
        // consistent with the rest of this page - not swapped to billable-only for hourly rows
        const seconds = hoursByClient.get(c.id) || 0
        const hours = seconds / 3600
        const rate = effectiveRate(totalRevenue, hours)
        const rateDeltaCents = rate !== null && targetRateCents > 0 ? rate - targetRateCents : null
        // Burn tracks usage against the retainer's own billing cycle (cycleProgress), which is a
        // genuinely different question from "how much revenue happened in the selected range" -
        // only meaningful for "this month", the one view where "the current cycle" is unambiguous.
        const cycleProgress = period.period === 'this_month' ? billingCycleProgress(c.billing_day || 1) : null
        const cycleEntriesForClient = cycleProgress
          ? cycleEntries.filter(
              (e) =>
                e.client_id === c.id &&
                e.started_at >= `${cycleProgress.cycleStart}T00:00:00` &&
                e.started_at < `${cycleProgress.cycleEnd}T00:00:00`,
            )
          : []
        const cycleSeconds = cycleEntriesForClient.reduce((s, e) => s + (e.duration_seconds || 0), 0)
        const burn = cycleProgress ? computeClientBurn(c, cycleSeconds, targetRateCents, today) : null
        const drivers = burn ? burnDrivers(cycleEntriesForClient, taskTitleMap) : []
        return {
          client: c,
          isHourly,
          chargesTotal,
          totalRevenue,
          seconds,
          hours,
          billableHours: billableSeconds / 3600,
          rate,
          rateDeltaCents,
          cycleProgress: !isHourly ? cycleProgress : null,
          retainerRevenue,
          burn,
          drivers,
        }
      })
      .filter((r) => r.totalRevenue > 0 || r.seconds > 0)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
  }, [clientsState, chargesByClient, hoursByClient, billableHoursByClient, targetRateCents, period.period, rangeStart, rangeEnd, cycleEntries, taskTitleMap, today])

  const memberRows = useMemo(() => {
    return members
      .map((m) => {
        let seconds = 0
        let revenue = 0
        for (const row of clientRows) {
          const memberSeconds = entriesState
            .filter((e) => e.user_id === m.user_id && e.client_id === row.client.id)
            .reduce((s, e) => s + (e.duration_seconds || 0), 0)
          seconds += memberSeconds
          if (row.rate) revenue += (memberSeconds / 3600) * row.rate
        }
        return { member: m, seconds, revenue }
      })
      .filter((r) => r.seconds > 0 || tasks.some((t) => t.assigned_to === r.member.user_id))
      .sort((a, b) => b.revenue - a.revenue)
  }, [members, clientRows, entriesState, tasks])

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
    const rate = effectiveRate(revenue, hours)
    return { revenue, hours, rate, rateDeltaCents: rate !== null && targetRateCents > 0 ? rate - targetRateCents : null }
  }, [clientRows, targetRateCents])

  // MRR and at-risk exposure are current-state snapshots, not scoped to the selected period -
  // a retainer is "at risk" regardless of which week you happen to be looking at.
  const mrrCents = useMemo(() => mrrCentsTotal(clientsState), [clientsState])
  const atRiskClients = useMemo(() => clientsState.filter((c) => getStage(c) === 'At Risk'), [clientsState])
  const atRiskCents = useMemo(() => atRiskClients.reduce((s, c) => s + (c.retainer_cents || 0), 0), [atRiskClients])
  const utilization = useMemo(() => {
    const totalSeconds = entriesState.reduce((s, e) => s + (e.duration_seconds || 0), 0)
    const billableSeconds = entriesState.filter((e) => e.billable).reduce((s, e) => s + (e.duration_seconds || 0), 0)
    return totalSeconds > 0 ? (billableSeconds / totalSeconds) * 100 : null
  }, [entriesState])
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
      <div className="text-xs text-sage/70 mb-5">
        Retainer revenue is spread evenly across the month - each day counts as its fair share, so a still-in-progress period shows the amount accrued so far.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3" data-tour="revenue-summary">
        <Card>
          <div className="text-xs text-sage mb-1">Total revenue</div>
          <div className="text-2xl font-heading font-bold">{fmtMoney(totals.revenue)}</div>
        </Card>
        <Card>
          <div className="text-xs text-sage mb-1">
            MRR <InfoTooltip content="Monthly recurring revenue - sum of active clients' monthly retainers" />
          </div>
          <div className="text-2xl font-heading font-bold">{fmtMoney(mrrCents)}</div>
        </Card>
        <Card>
          <div className="text-xs text-sage mb-1">Hours logged</div>
          <div className="text-2xl font-heading font-bold">{totals.hours.toFixed(1)}</div>
        </Card>
        <Card>
          <div className="text-xs text-sage mb-1">
            Blended rate <InfoTooltip content="Total revenue divided by total hours logged, across all clients" />
          </div>
          <div className="text-2xl font-heading font-bold">{totals.rate ? `${currencySign}${centsToDollars(totals.rate)}/hr` : '-'}</div>
        </Card>
        <Card>
          <div className="text-xs text-sage mb-1">
            vs. target rate <InfoTooltip content="Blended rate compared to the target hourly rate set in Settings → General" />
          </div>
          <div className={`text-2xl font-heading font-bold ${totals.rateDeltaCents !== null && totals.rateDeltaCents < 0 ? 'text-red-600' : ''}`}>
            {totals.rateDeltaCents !== null ? formatRateDelta(totals.rateDeltaCents) : '-'}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-sage mb-1">
            Billable utilization <InfoTooltip content="Share of logged hours marked billable" />
          </div>
          <div className="text-2xl font-heading font-bold">{utilization !== null ? `${utilization.toFixed(0)}%` : '-'}</div>
        </Card>
      </div>
      {targetRateCents === 0 && (
        <div className="text-xs text-sage bg-white rounded-2xl border border-ink/8 p-3 mb-3">
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

      <div className="text-xs font-semibold tracking-wide text-sage mb-2" data-tour="revenue-billables">By client</div>
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
                      <span className="text-sage ml-2 text-xs">
                        {fmtMoney(r.client.retainer_cents)}/mo retainer · renews in{' '}
                        {(() => {
                          const days = daysUntilRenewal(r.client.billing_day || 1)
                          return `${days} day${days === 1 ? '' : 's'}`
                        })()}
                      </span>
                    ) : null}
                    {r.client.retainer_cents ? (
                      <InfoTooltip content={`${fmtMoney(r.retainerRevenue)} of this month's retainer accrued so far, spread evenly across the month.`} />
                    ) : null}
                    {r.burn && (
                      <span
                        className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold align-middle"
                        style={{
                          color: r.burn.status === 'ok' ? '#5d6b5c' : r.burn.status === 'warn' ? '#cc9a3c' : '#e05070',
                          background: r.burn.status === 'ok' ? '#5d6b5c18' : r.burn.status === 'warn' ? '#cc9a3c18' : '#e0507018',
                        }}
                        title={`${r.burn.hoursLogged.toFixed(1)}h of ~${r.burn.hoursBudget.toFixed(1)}h supported by the retainer, ${r.burn.cycle.elapsedDays} of ${r.burn.cycle.cycleLengthDays} days into this cycle.`}
                      >
                        {Math.round(r.burn.percent)}% burn
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-4 shrink-0">
                    <span className="text-sage w-14 text-right inline-flex items-center justify-end gap-1">
                      {formatHours(r.seconds)}h
                      {r.isHourly && Math.abs(r.hours - r.billableHours) > 0.05 && (
                        <InfoTooltip
                          content={`${formatHours(r.seconds)}h logged, but only ${r.billableHours.toFixed(1)}h marked billable - revenue is calculated from billable hours only.`}
                        />
                      )}
                    </span>
                    <span className={`w-16 text-right ${r.rateDeltaCents !== null && r.rateDeltaCents < 0 ? 'text-red-600' : 'text-sage'}`}>
                      {r.rate ? `${currencySign}${centsToDollars(r.rate)}/hr` : '-'}
                    </span>
                    <span className="font-medium w-16 text-right">{fmtMoney(r.totalRevenue)}</span>
                    <span
                      className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center transition-all ${
                        expanded ? 'bg-ink text-white rotate-180' : 'bg-sand text-sage group-hover:bg-ink/10 group-hover:text-ink'
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
                    {r.burn && (
                      <div className="text-xs text-sage">
                        <div>
                          {r.burn.hoursLogged.toFixed(1)}h logged of ~{r.burn.hoursBudget.toFixed(1)}h supported by the retainer, day{' '}
                          {r.burn.cycle.elapsedDays} of {r.burn.cycle.cycleLengthDays} in this cycle.
                          {r.burn.projectedOverageHours > 0 &&
                            ` At the current pace, on track to run about ${r.burn.projectedOverageHours.toFixed(1)}h over budget by cycle end.`}
                        </div>
                        {r.drivers.length > 0 && (
                          <div className="mt-1">
                            Top drivers:{' '}
                            {r.drivers.map((d: BurnDriver, i: number) => (
                              <span key={d.title}>
                                {i > 0 && ', '}
                                {d.title} {d.hours.toFixed(1)}h
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
                                <XIcon size={12} />
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

      <div className="text-xs font-semibold tracking-wide text-sage mb-2">By teammate</div>
      {memberRows.length === 0 ? (
        <div className="text-sm text-sage py-4">No time logged or tasks assigned this month.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {memberRows.map((r, i) => {
            const stats = taskStatsByMember.get(r.member.user_id) || { completed: 0, completedLate: 0, overdueIncomplete: 0 }
            return (
              <Card key={r.member.user_id}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar member={r.member} index={i} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{memberName(r.member)}</div>
                      {r.member.role && (
                        <div className="text-xs text-sage capitalize truncate">
                          {r.member.role}
                          {r.member.title && ` · ${r.member.title}`}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-5 shrink-0">
                    <StatMeter label="Hours" value={r.seconds} max={maxMemberSeconds} display={`${formatHours(r.seconds)}h`} />
                    <StatMeter label="Revenue" value={r.revenue} max={maxMemberRevenue} display={fmtMoney(Math.round(r.revenue))} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-ink/8">
                  <div className="rounded-lg bg-sand px-3 py-1.5 text-xs">
                    <span className="font-semibold">{stats.completed}</span> <span className="text-sage">completed</span>
                  </div>
                  <div className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs ${stats.overdueIncomplete > 0 ? 'bg-red-100' : 'bg-sand'}`}>
                    {stats.overdueIncomplete > 0 && <AlertTriangleIcon size={13} className="text-red-600 shrink-0" />}
                    <span className={`font-semibold ${stats.overdueIncomplete > 0 ? 'text-red-600' : ''}`}>{stats.overdueIncomplete}</span>{' '}
                    <span className={stats.overdueIncomplete > 0 ? 'text-red-600' : 'text-sage'}>overdue</span>
                  </div>
                  <div className={`rounded-lg px-3 py-1.5 text-xs ${stats.completedLate > 0 ? 'bg-amber-100' : 'bg-sand'}`}>
                    <span className={`font-semibold ${stats.completedLate > 0 ? 'text-amber-700' : ''}`}>{stats.completedLate}</span>{' '}
                    <span className={stats.completedLate > 0 ? 'text-amber-700' : 'text-sage'}>completed late</span>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
