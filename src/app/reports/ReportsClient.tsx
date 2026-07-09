'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { formatDate, todayKey, memberName, effectiveRate, isRateComparisonMeaningful } from '@/lib/agency'
import { monthElapsedFraction, billingCycleElapsedFraction } from '@/lib/period'
import DatePicker from '@/components/ui/DatePicker'
import CustomSelect from '@/components/ui/CustomSelect'
import TrendLineChart from '@/components/charts/TrendLineChart'
import DivergingBarChart from '@/components/charts/DivergingBarChart'
import type { ReportRange } from './page'
import InfoTooltip from '@/components/ui/InfoTooltip'

type Client = { id: string; name: string; retainer_cents: number | null; billing_mode: string | null; hourly_rate_cents: number | null; billing_day: number | null }
type Task = { id: string; client_id: string | null; assigned_to: string | null; title: string; completed_at: string | null }
type OpenTask = { id: string; assigned_to: string | null }
type TimeEntry = { client_id: string | null; user_id: string; duration_seconds: number | null }
type WeekTimeEntry = { user_id: string; duration_seconds: number | null }
type MonthTimeEntry = { client_id: string | null; duration_seconds: number | null; started_at: string; billable: boolean }
type PaidInvoice = { client_id: string; amount_cents: number; paid_at: string }
type Member = {
  user_id: string
  invited_email: string | null
  display_name?: string | null
  avatar_url?: string | null
  target_hours_per_week?: number | null
}
type Report = { period_type: 'week' | 'month'; period_start: string; content: string }

function monthLabel(monthStart: string) {
  const [y, m] = monthStart.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function reportLabel(r: Report) {
  return r.period_type === 'week' ? `Week of ${formatDate(r.period_start)}` : monthLabel(r.period_start)
}

const RANGE_LABELS: Record<ReportRange, string> = {
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

type View = 'overview' | 'profitability' | 'capacity'
const NAV: { value: View; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'profitability', label: 'Profitability' },
  { value: 'capacity', label: 'Capacity' },
]

export default function ReportsClient({
  orgId,
  range,
  clients,
  tasks,
  entries,
  members,
  reports,
  weekAnchor,
  hasApiKey,
  openTasks,
  weekTimeEntries,
  monthTimeEntries,
  monthPaidInvoices,
  targetRateCents,
  pMonth,
  trendMonthKeys,
}: {
  orgId: string
  range: ReportRange
  clients: Client[]
  tasks: Task[]
  entries: TimeEntry[]
  members: Member[]
  reports: Report[]
  weekAnchor: string
  hasApiKey: boolean
  openTasks: OpenTask[]
  weekTimeEntries: WeekTimeEntry[]
  monthTimeEntries: MonthTimeEntry[]
  monthPaidInvoices: PaidInvoice[]
  targetRateCents: number
  pMonth: string
  trendMonthKeys: string[]
}) {
  const router = useRouter()
  const [view, setView] = useState<View>('overview')
  const [recap, setRecap] = useState<string | null>(reports.find((r) => r.period_type === 'week' && r.period_start === weekAnchor)?.content ?? null)
  const [loadingRecap, setLoadingRecap] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [scopeNotes, setScopeNotes] = useState<Record<string, string>>({})
  const [loadingNote, setLoadingNote] = useState<string | null>(null)

  const [backfillType, setBackfillType] = useState<'week' | 'month'>('week')
  const [backfillDate, setBackfillDate] = useState(todayKey())
  const [loadingBackfill, setLoadingBackfill] = useState(false)
  const [backfillResult, setBackfillResult] = useState<string | null>(null)
  const [showBackfill, setShowBackfill] = useState(false)
  const [libraryTypeFilter, setLibraryTypeFilter] = useState<'all' | 'week' | 'month'>('all')
  const [justGeneratedKey, setJustGeneratedKey] = useState<string | null>(null)

  function highlightReport(key: string) {
    setExpanded((prev) => new Set(prev).add(key))
    setJustGeneratedKey(key)
    setTimeout(() => {
      document.getElementById(`report-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    setTimeout(() => setJustGeneratedKey((k) => (k === key ? null : k)), 4000)
  }

  async function generateRecap() {
    setLoadingRecap(true)
    try {
      const res = await fetch('/api/ai/generate-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, periodType: 'week' }),
      })
      const body = await res.json()
      setRecap(res.ok ? body.recap : body.error || 'Failed to generate.')
      if (res.ok) highlightReport(`week:${weekAnchor}`)
      router.refresh()
    } finally {
      setLoadingRecap(false)
    }
  }

  // Backfills or regenerates a report for any past week/month, not just "this week" - the fix
  // for forgetting to generate one on time. Lands in the Report library below via router.refresh().
  async function generateBackfill() {
    setLoadingBackfill(true)
    setBackfillResult(null)
    try {
      const res = await fetch('/api/ai/generate-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, periodType: backfillType, periodStart: backfillDate }),
      })
      const body = await res.json()
      if (res.ok) {
        setBackfillResult(`Generated for ${backfillType === 'week' ? `week of ${formatDate(body.periodStart)}` : monthLabel(body.periodStart)}.`)
        setLibraryTypeFilter('all')
        highlightReport(`${body.periodType}:${body.periodStart}`)
        router.refresh()
      } else {
        setBackfillResult(body.error || 'Failed to generate.')
      }
    } finally {
      setLoadingBackfill(false)
    }
  }

  async function explainScopeCreep(clientId: string) {
    setLoadingNote(clientId)
    try {
      const res = await fetch('/api/ai/scope-creep-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, clientId, periodStart: pMonth }),
      })
      const body = await res.json()
      setScopeNotes((prev) => ({ ...prev, [clientId]: res.ok ? body.note : body.error || 'Failed to generate.' }))
    } finally {
      setLoadingNote(null)
    }
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const clientReports = useMemo(() => {
    return clients
      .map((c) => {
        const clientTasks = tasks.filter((t) => t.client_id === c.id)
        const clientEntries = entries.filter((e) => e.client_id === c.id)
        const totalSeconds = clientEntries.reduce((s, e) => s + (e.duration_seconds || 0), 0)

        const byAssignee = new Map<string, { label: string; count: number }>()
        for (const t of clientTasks) {
          const key = t.assigned_to || 'unassigned'
          const label = t.assigned_to ? memberName(members.find((m) => m.user_id === t.assigned_to)) : 'Unassigned'
          const existing = byAssignee.get(key)
          if (existing) existing.count += 1
          else byAssignee.set(key, { label, count: 1 })
        }

        const byLogger = new Map<string, { label: string; seconds: number }>()
        for (const e of clientEntries) {
          const existing = byLogger.get(e.user_id)
          if (existing) existing.seconds += e.duration_seconds || 0
          else byLogger.set(e.user_id, { label: memberName(members.find((m) => m.user_id === e.user_id)), seconds: e.duration_seconds || 0 })
        }

        return {
          client: c,
          taskCount: clientTasks.length,
          totalSeconds,
          tasks: clientTasks,
          byAssignee: [...byAssignee.values()].sort((a, b) => b.count - a.count),
          byLogger: [...byLogger.values()].sort((a, b) => b.seconds - a.seconds),
        }
      })
      .filter((r) => r.taskCount > 0 || r.totalSeconds > 0)
      .sort((a, b) => b.taskCount + b.totalSeconds / 3600 - (a.taskCount + a.totalSeconds / 3600))
  }, [clients, tasks, entries, members])

  // Verdolo doesn't track real expenses, so there's no honest "cost"/"margin" in dollars -
  // only hours logged vs. revenue. Effective rate (revenue ÷ hours) compared against the
  // team's target rate gives the same "is this account worth the time it's taking" signal
  // without pretending to know a real P&L. Shared by the selected-month breakdown below and
  // by monthlyTrend (run once per month in the trailing window).
  function profitabilityForMonth(monthKey: string) {
    const monthEntries = monthTimeEntries.filter((e) => e.started_at.slice(0, 7) === monthKey)
    const monthInvoices = monthPaidInvoices.filter((i) => i.paid_at.slice(0, 7) === monthKey)
    return clients
      .map((c) => {
        const clientEntries = monthEntries.filter((e) => e.client_id === c.id)
        const hours = clientEntries.reduce((s, e) => s + (e.duration_seconds || 0), 0) / 3600
        const paidCents = monthInvoices.filter((i) => i.client_id === c.id).reduce((s, i) => s + i.amount_cents, 0)
        const isHourly = c.billing_mode === 'hourly'
        // A fully-elapsed or future month prorates by calendar bounds regardless of billing day
        // (the retainer was either fully realized already or hasn't started); only the currently
        // in-progress month uses the client's own billing-cycle day to determine how much of
        // their retainer has "renewed" so far.
        const isCurrentMonth = monthKey === todayKey().slice(0, 7)
        const retainerFraction = isCurrentMonth ? billingCycleElapsedFraction(c.billing_day || 1) : monthElapsedFraction(monthKey)
        const estimatedCents = isHourly
          ? Math.round((clientEntries.filter((e) => e.billable).reduce((s, e) => s + (e.duration_seconds || 0), 0) / 3600) * (c.hourly_rate_cents || 0))
          : Math.round((c.retainer_cents || 0) * retainerFraction)
        const revenueCents = paidCents || estimatedCents
        const effectiveRateCents = effectiveRate(revenueCents, hours)
        const rateDeltaCents = isRateComparisonMeaningful(c) && effectiveRateCents !== null ? effectiveRateCents - targetRateCents : null
        const isPartialMonth = retainerFraction < 1
        return { client: c, isHourly, hours, revenueCents, effectiveRateCents, rateDeltaCents, isEstimatedRevenue: !paidCents, isPartialMonth }
      })
      .filter((r) => r.revenueCents > 0 || r.hours > 0)
      .sort((a, b) => {
        if (a.rateDeltaCents === null) return 1
        if (b.rateDeltaCents === null) return -1
        return a.rateDeltaCents - b.rateDeltaCents
      })
  }

  const profitability = useMemo(
    () => profitabilityForMonth(pMonth),
    [clients, monthTimeEntries, monthPaidInvoices, targetRateCents, pMonth],
  )

  const monthlyTrend = useMemo(() => {
    return trendMonthKeys.map((monthKey) => {
      const perClient = profitabilityForMonth(monthKey)
      const totalRevenue = perClient.reduce((s, r) => s + r.revenueCents, 0)
      const totalHours = perClient.reduce((s, r) => s + r.hours, 0)
      return {
        month: monthKey,
        // An effective rate needs a denominator - a month with retainer revenue but zero
        // logged hours has no *rate* to report, not a rate of $0 (retainer_cents is always
        // "current", so every month trivially has revenue even before a client was active).
        blendedRateCents: effectiveRate(totalRevenue, totalHours) ?? 0,
        hasData: effectiveRate(totalRevenue, totalHours) !== null,
      }
    })
  }, [clients, monthTimeEntries, monthPaidInvoices, targetRateCents, trendMonthKeys])

  function onMonthChange(next: string) {
    router.push(`/reports?pMonth=${next}`)
  }

  function shiftMonth(monthKey: string, delta: number) {
    const [y, m] = monthKey.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  function formatRate(centsPerHour: number) {
    return `$${Math.round(centsPerHour / 100).toLocaleString()}/hr`
  }
  function formatRateDelta(centsPerHour: number) {
    const sign = centsPerHour >= 0 ? '+' : '−'
    return `${sign}$${Math.round(Math.abs(centsPerHour) / 100).toLocaleString()}/hr`
  }

  const capacity = useMemo(() => {
    return members
      .map((m) => {
        const openCount = openTasks.filter((t) => t.assigned_to === m.user_id).length
        const seconds = weekTimeEntries.filter((e) => e.user_id === m.user_id).reduce((s, e) => s + (e.duration_seconds || 0), 0)
        const targetHours = m.target_hours_per_week ?? null
        return { member: m, openCount, seconds, hours: seconds / 3600, targetHours }
      })
      .sort((a, b) => b.openCount - a.openCount)
  }, [members, openTasks, weekTimeEntries])
  const maxOpenCount = Math.max(1, ...capacity.map((c) => c.openCount))

  function onRangeChange(next: string) {
    router.push(`/reports?range=${next}`)
  }

  return (
    <div>
      <div className="mb-5">
        <div className="font-heading text-2xl font-bold text-ink">Reports</div>
        <div className="text-sm text-sage mt-1">Client activity, profitability, team capacity, and the weekly recap library.</div>
      </div>

      <div className="flex gap-1 mb-6 bg-sand/60 rounded-full p-1 w-fit">
        {NAV.map((item) => (
          <button
            key={item.value}
            onClick={() => setView(item.value)}
            className={`relative rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
              view === item.value ? 'font-medium text-ink' : 'text-sage hover:text-ink'
            }`}
          >
            {view === item.value && (
              <motion.div
                layoutId="reports-nav-active"
                className="absolute inset-0 rounded-full bg-white"
                style={{ boxShadow: 'inset 2px 0 0 0 var(--accent), 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">{item.label}</span>
          </button>
        ))}
      </div>

      {view === 'overview' && (
        <>
          <div className="mb-6">
            <CustomSelect
              value={range}
              onChange={(v) => onRangeChange(v)}
              options={(Object.keys(RANGE_LABELS) as ReportRange[]).map((r) => ({ value: r, label: RANGE_LABELS[r] }))}
              className="w-40"
            />
          </div>

          <div className="mb-8">
            <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Weekly overall recap</div>
            {recap ? (
              <div className="rounded-2xl bg-white shadow-md border-l-4 border-accent p-4">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-xs font-semibold uppercase text-sage">Week of {formatDate(weekAnchor)}</div>
                  <button className="text-xs text-sage hover:text-ink" onClick={generateRecap} disabled={loadingRecap}>
                    ↺ Regenerate
                  </button>
                </div>
                <div className="text-sm leading-relaxed text-ink">{loadingRecap ? 'Generating…' : recap}</div>
              </div>
            ) : (
              <button
                className="w-full rounded-xl border border-ink/10 bg-white py-2 text-sm text-sage shadow-md disabled:opacity-50"
                onClick={generateRecap}
                disabled={loadingRecap || !hasApiKey}
              >
                {loadingRecap ? '⏳ Generating recap…' : hasApiKey ? '✨ Generate weekly recap' : 'AI features aren’t configured on this deployment'}
              </button>
            )}
          </div>

          <div className="mb-8">
            <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">By client · {RANGE_LABELS[range]}</div>
            {clientReports.length === 0 ? (
              <div className="text-sm text-sage py-3">No task or time activity in this range.</div>
            ) : (
              <div className="space-y-3">
                {clientReports.map((r) => (
                  <div key={r.client.id} className="rounded-2xl bg-white shadow-md p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div className="text-sm font-semibold text-ink">{r.client.name}</div>
                      <div className="flex gap-3 text-xs text-sage">
                        <span>
                          {r.taskCount} task{r.taskCount !== 1 ? 's' : ''} done
                        </span>
                        <span>{formatDuration(r.totalSeconds)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-sage/70 mb-1">Tasks by who</div>
                        {r.byAssignee.length === 0 ? (
                          <div className="text-xs text-sage">-</div>
                        ) : (
                          r.byAssignee.map((a) => (
                            <div key={a.label} className="flex justify-between text-xs py-0.5">
                              <span className="text-ink">{a.label}</span>
                              <span className="text-sage">{a.count}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-sage/70 mb-1">Time by who</div>
                        {r.byLogger.length === 0 ? (
                          <div className="text-xs text-sage">-</div>
                        ) : (
                          r.byLogger.map((l) => (
                            <div key={l.label} className="flex justify-between text-xs py-0.5">
                              <span className="text-ink">{l.label}</span>
                              <span className="text-sage">{formatDuration(l.seconds)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-sage">Report library</div>
              <div className="flex items-center gap-2">
                {reports.length > 0 && (
                  <CustomSelect
                    value={libraryTypeFilter}
                    onChange={(v) => setLibraryTypeFilter(v as 'all' | 'week' | 'month')}
                    options={[
                      { value: 'all', label: 'All' },
                      { value: 'week', label: 'Weekly' },
                      { value: 'month', label: 'Monthly' },
                    ]}
                    className="w-28"
                  />
                )}
                <button
                  type="button"
                  className="text-xs text-sage hover:text-ink transition-colors whitespace-nowrap"
                  onClick={() => setShowBackfill((v) => !v)}
                >
                  {showBackfill ? 'Cancel' : '+ Generate for a past period'}
                </button>
              </div>
            </div>

            {showBackfill && (
              <div className="rounded-xl bg-white shadow-md p-4 mb-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <div className="flex gap-1 bg-sand/60 rounded-full p-1 w-fit">
                    {(['week', 'month'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setBackfillType(t)}
                        className={`relative rounded-full px-3 py-1.5 text-sm capitalize transition-colors ${
                          backfillType === t ? 'font-medium text-ink' : 'text-sage hover:text-ink'
                        }`}
                      >
                        {backfillType === t && (
                          <motion.div
                            layoutId="backfill-type-active"
                            className="absolute inset-0 rounded-full bg-white"
                            style={{ boxShadow: 'inset 2px 0 0 0 var(--accent), 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                          />
                        )}
                        <span className="relative">{t}</span>
                      </button>
                    ))}
                  </div>
                  {backfillType === 'week' ? (
                    <DatePicker value={backfillDate} onChange={setBackfillDate} placeholder="Pick a date in that week…" className="w-44" />
                  ) : (
                    <input
                      type="month"
                      value={backfillDate.slice(0, 7)}
                      onChange={(e) => e.target.value && setBackfillDate(`${e.target.value}-01`)}
                      className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-sm"
                    />
                  )}
                  <button
                    className="rounded-full bg-accent text-white shadow-md px-3.5 py-1.5 text-sm font-medium disabled:opacity-50"
                    onClick={generateBackfill}
                    disabled={loadingBackfill || !hasApiKey}
                  >
                    {loadingBackfill ? 'Generating…' : 'Generate'}
                  </button>
                </div>
                <div className="text-xs text-sage">
                  {!hasApiKey
                    ? 'AI features aren’t configured on this deployment.'
                    : backfillType === 'week'
                      ? 'Pick any date - it snaps to that date’s Monday–Sunday week.'
                      : 'Pick any month to generate or regenerate its recap.'}
                </div>
                {backfillResult && <div className="text-xs text-ink mt-2">{backfillResult}</div>}
              </div>
            )}

            {reports.length === 0 ? (
              <div className="text-sm text-sage py-3">No past reports yet.</div>
            ) : (
              <div className="space-y-2">
                {reports
                  .filter((r) => libraryTypeFilter === 'all' || r.period_type === libraryTypeFilter)
                  .map((r) => {
                    const key = `${r.period_type}:${r.period_start}`
                    const isOpen = expanded.has(key)
                    const isJustGenerated = justGeneratedKey === key
                    return (
                      <div
                        key={key}
                        id={`report-${key}`}
                        className={`rounded-2xl bg-white shadow-md overflow-hidden transition-shadow ${
                          isJustGenerated ? 'ring-2 ring-accent' : ''
                        }`}
                      >
                        <button
                          className="flex w-full justify-between items-center text-left p-4 hover:bg-sand/40 transition-colors"
                          onClick={() => toggleExpanded(key)}
                        >
                          <span className="text-xs font-semibold text-sage flex items-center gap-2">
                            {reportLabel(r)} <span className="text-sage/50 capitalize">· {r.period_type}</span>
                            {isJustGenerated && (
                              <span className="rounded-full bg-accent/10 text-accent px-2 py-0.5 text-[10px] font-semibold normal-case">Just generated</span>
                            )}
                          </span>
                          <span className="text-xs text-sage">{isOpen ? '▾' : '▸'}</span>
                        </button>
                        {isOpen && <div className="text-sm leading-relaxed text-ink px-4 pb-4">{r.content}</div>}
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        </>
      )}

      {view === 'profitability' && (
        <div>
          <div className="mb-6 flex items-center gap-1 rounded-full border border-ink/10 bg-white shadow-md w-fit px-1 py-1">
            <button
              type="button"
              className="w-7 h-7 rounded-full text-sage hover:text-ink hover:bg-sand/60 transition-colors"
              onClick={() => onMonthChange(shiftMonth(pMonth, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="px-2 text-sm font-medium min-w-[8rem] text-center">{monthLabel(`${pMonth}-01`)}</span>
            <button
              type="button"
              className="w-7 h-7 rounded-full text-sage hover:text-ink hover:bg-sand/60 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
              onClick={() => onMonthChange(shiftMonth(pMonth, 1))}
              disabled={pMonth >= todayKey().slice(0, 7)}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          {targetRateCents === 0 && (
            <div className="text-sm text-sage bg-white rounded-xl shadow-md p-3 mb-4">
              Verdolo doesn&apos;t track expenses, so there&apos;s no real cost/margin here - set a target hourly rate in Settings → General to
              see how each account&apos;s effective rate compares (no target set yet).
            </div>
          )}

          <div className="mb-8">
            <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">
              Effective rate · last 6 months <InfoTooltip content="Revenue divided by hours logged, compared to your target hourly rate" />
            </div>
            {pMonth === todayKey().slice(0, 7) && (
              <div className="text-xs text-sage mb-2">
                This month&apos;s retainer revenue is prorated to date and will settle as more hours are logged.
              </div>
            )}
            {monthlyTrend.every((m) => !m.hasData) ? (
              <div className="text-sm text-sage py-3">No revenue or logged time yet.</div>
            ) : (
              <div className="rounded-2xl bg-white shadow-md p-4">
                <TrendLineChart
                  months={trendMonthKeys}
                  formatValue={(cents) => formatRate(cents)}
                  referenceLine={targetRateCents > 0 ? { value: targetRateCents, label: `Target ${formatRate(targetRateCents)}` } : undefined}
                  series={[
                    {
                      key: 'rate',
                      label: 'Effective rate',
                      color: '#898781',
                      values: monthlyTrend.map((m) => m.blendedRateCents),
                      pointColors:
                        targetRateCents > 0
                          ? monthlyTrend.map((m) => (!m.hasData ? '#c3c2b7' : m.blendedRateCents >= targetRateCents ? '#2a78d6' : '#e05070'))
                          : undefined,
                    },
                  ]}
                />
              </div>
            )}
          </div>

          {targetRateCents > 0 && profitability.some((r) => r.rateDeltaCents !== null) && (
            <div className="mb-8">
              <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">
                Effective rate by client · {monthLabel(`${pMonth}-01`)}{' '}
                <InfoTooltip content="Each client's revenue divided by hours logged, compared to your target hourly rate" />
              </div>
              {pMonth === todayKey().slice(0, 7) && (
                <div className="text-xs text-sage mb-2">
                  This month&apos;s retainer revenue is prorated to date and will settle as more hours are logged.
                </div>
              )}
              <div className="rounded-2xl bg-white shadow-md p-4">
                <DivergingBarChart
                  items={profitability
                    .filter((r) => r.rateDeltaCents !== null)
                    .map((r) => ({ id: r.client.id, label: r.client.name, valueCents: r.rateDeltaCents as number }))}
                  formatValue={(cents) => formatRateDelta(cents)}
                />
              </div>
            </div>
          )}

          <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Client detail · {monthLabel(`${pMonth}-01`)}</div>
          {profitability.length === 0 ? (
            <div className="text-sm text-sage py-3">No revenue or logged time in {monthLabel(`${pMonth}-01`)} yet.</div>
          ) : (
            <div className="space-y-3">
              {profitability.map((r) => {
                const isBelowTarget = targetRateCents > 0 && r.rateDeltaCents !== null && r.rateDeltaCents < 0
                return (
                  <div key={r.client.id} className={`rounded-2xl bg-white shadow-md p-4 ${isBelowTarget ? 'border-l-4 border-red-400' : ''}`}>
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-ink">{r.client.name}</div>
                        {isBelowTarget && <span className="text-[10px] rounded-full bg-red-50 text-red-600 px-2 py-0.5 font-semibold">⚠ Scope creep</span>}
                      </div>
                      <div className={`text-sm font-semibold ${isBelowTarget ? 'text-red-600' : 'text-ink'}`}>
                        {r.isHourly
                          ? `Hourly @ $${centsToDollars(r.client.hourly_rate_cents || 0)}/hr`
                          : r.effectiveRateCents !== null
                            ? formatRate(r.effectiveRateCents)
                            : 'No hours logged'}
                        {!r.isHourly && targetRateCents > 0 && r.rateDeltaCents !== null && (
                          <span className="text-xs font-normal text-sage ml-1">({formatRateDelta(r.rateDeltaCents)} vs target)</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-sage">
                      <span>
                        Revenue ${centsToDollars(r.revenueCents)}
                        {r.isEstimatedRevenue &&
                          (r.isHourly ? ' (hourly, est.)' : r.isPartialMonth ? ' (retainer, est., prorated)' : ' (retainer, est.)')}
                      </span>
                      <span>{r.hours.toFixed(1)}h logged</span>
                    </div>
                    {isBelowTarget && (
                      <div className="mt-2">
                        {scopeNotes[r.client.id] ? (
                          <div className="text-xs text-ink bg-red-50/60 rounded-lg p-2">{scopeNotes[r.client.id]}</div>
                        ) : (
                          <button
                            className="text-xs text-sage hover:text-ink underline disabled:opacity-50"
                            onClick={() => explainScopeCreep(r.client.id)}
                            disabled={loadingNote === r.client.id || !hasApiKey}
                            title={hasApiKey ? undefined : 'AI features aren’t configured on this deployment'}
                          >
                            {loadingNote === r.client.id ? 'Thinking…' : hasApiKey ? '✨ Explain with AI' : 'AI unavailable'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {view === 'capacity' && (
        <div>
          {capacity.some((r) => r.targetHours !== null && r.targetHours > 0) && (
            <div className="mb-8">
              <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Hours vs. target · this week</div>
              <div className="rounded-2xl bg-white shadow-md p-4">
                <DivergingBarChart
                  items={capacity
                    .filter((r) => r.targetHours !== null && r.targetHours > 0)
                    .map((r) => ({
                      id: r.member.user_id,
                      label: memberName(r.member),
                      // Target hours is a utilization floor, not a capacity ceiling - falling
                      // short is the problem case (red), meeting/exceeding it is fine (blue).
                      valueCents: (r.hours - (r.targetHours as number)) * 100,
                    }))}
                  formatValue={(cents) => {
                    const hrs = cents / 100
                    return hrs >= 0 ? `+${hrs.toFixed(1)}h over` : `${Math.abs(hrs).toFixed(1)}h under`
                  }}
                  positiveLabel="On track"
                  negativeLabel="Under target"
                />
              </div>
            </div>
          )}

          <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Open workload · this week</div>
          {capacity.length === 0 ? (
            <div className="text-sm text-sage py-3">No team members yet.</div>
          ) : (
            <div className="space-y-3">
              {capacity.map((r) => (
                <div key={r.member.user_id} className="rounded-2xl bg-white shadow-md p-4">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-sm font-semibold text-ink">{memberName(r.member)}</div>
                    <div className="flex gap-3 text-xs text-sage">
                      <span>
                        {r.openCount} open task{r.openCount !== 1 ? 's' : ''}
                      </span>
                      <span>{formatDuration(r.seconds)} this week</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-sand overflow-hidden">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(r.openCount / maxOpenCount) * 100}%` }} />
                  </div>
                  {r.targetHours !== null && r.targetHours > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[11px] text-sage mb-1">
                        <span>Hours vs. target</span>
                        <span>
                          {r.hours.toFixed(1)}h / {r.targetHours}h
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-sand overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (r.hours / r.targetHours) * 100)}%`,
                            background: r.hours < r.targetHours ? '#e05070' : 'var(--accent)',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
