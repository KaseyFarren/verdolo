'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import {
  formatDate,
  todayKey,
  getWeekAnchor,
  getStage,
  clientHealthKey,
  HEALTH_COLOR,
  HEALTH_LABEL,
  memberName,
  effectiveRate,
  currencySymbol,
  type Currency,
} from '@/lib/agency'
import {
  smoothedRetainerRevenueCents,
  monthKeyRange,
  clientExistedBy,
  clientChurnedBefore,
  addDays,
  periodBounds,
  type Period,
  type PeriodValue,
} from '@/lib/period'
import BarChart from '@/components/charts/BarChart'
import Card from '@/components/ui/Card'
import DatePicker from '@/components/ui/DatePicker'
import MonthPicker from '@/components/ui/MonthPicker'
import CustomSelect from '@/components/ui/CustomSelect'
import PeriodSelector from '@/components/ui/PeriodSelector'
import TrendLineChart from '@/components/charts/TrendLineChart'
import DivergingBarChart from '@/components/charts/DivergingBarChart'
import InfoTooltip from '@/components/ui/InfoTooltip'
import Tooltip from '@/components/ui/Tooltip'
import { AlertTriangleIcon, CheckIcon, ClockIcon, RefreshIcon, SparkleIcon } from '@/components/ui/icons'
import Avatar from '@/components/ui/Avatar'

type Client = {
  id: string
  name: string
  retainer_cents: number | null
  billing_mode: string | null
  hourly_rate_cents: number | null
  billing_day: number | null
  stage: string | null
  status: string | null
  last_contacted: string | null
  cadence_days: number | null
  added_date: string | null
  churned_at: string | null
}
type Task = { id: string; client_id: string | null; assigned_to: string | null; title: string; completed_at: string | null }
type OpenTask = { id: string; assigned_to: string | null }
type TimeEntry = { client_id: string | null; user_id: string; duration_seconds: number | null }
type WeekTimeEntry = { user_id: string; duration_seconds: number | null }
type MonthTimeEntry = { client_id: string | null; duration_seconds: number | null; started_at: string; billable: boolean }
type ClientCharge = { client_id: string; amount_cents: number; charged_on: string }
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

function monthTick(monthKey: string) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })
}

function weekTick(weekStart: string) {
  const [y, m, d] = weekStart.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Walks backward `count` Mondays from (and including) `anchorMonday`, oldest first.
function buildWeekKeys(anchorMonday: string, count: number) {
  const keys: string[] = []
  let cur = anchorMonday
  for (let i = 0; i < count; i++) {
    keys.unshift(cur)
    cur = addDays(cur, -7)
  }
  return keys
}

type TrendGranularity = 'month' | 'week'
const MONTH_COUNT_OPTIONS = [3, 6, 12]
const WEEK_COUNT_OPTIONS = [4, 8, 12, 26]

function reportLabel(r: Report) {
  return r.period_type === 'week' ? `Week of ${formatDate(r.period_start)}` : monthLabel(r.period_start)
}

const REPORT_RANGE_PRESETS: Period[] = ['this_week', 'last_week', 'this_month', 'last_month', 'custom']

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
  monthClientCharges,
  targetRateCents,
  pMonth,
  trendMonthKeys,
  currency,
}: {
  orgId: string
  range: PeriodValue
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
  monthClientCharges: ClientCharge[]
  targetRateCents: number
  pMonth: string
  trendMonthKeys: string[]
  currency?: Currency
}) {
  const currencySign = currencySymbol(currency)
  const rangeLabel = periodBounds(range).label
  const router = useRouter()

  // The recap card follows whichever preset is selected above - a custom range has no single
  // matching report period, so it has nothing to show/generate here (the backfill widget in the
  // library below still covers arbitrary weeks/months).
  const recapPeriod = useMemo(() => {
    switch (range.period) {
      case 'this_week':
        return { type: 'week' as const, start: weekAnchor, label: `Week of ${formatDate(weekAnchor)}` }
      case 'last_week': {
        const start = addDays(weekAnchor, -7)
        return { type: 'week' as const, start, label: `Week of ${formatDate(start)}` }
      }
      case 'this_month': {
        const start = `${todayKey().slice(0, 7)}-01`
        return { type: 'month' as const, start, label: monthLabel(start) }
      }
      case 'last_month': {
        const start = `${shiftMonth(todayKey().slice(0, 7), -1)}-01`
        return { type: 'month' as const, start, label: monthLabel(start) }
      }
      default:
        return null
    }
  }, [range.period, weekAnchor])

  const [view, setView] = useState<View>('overview')
  // Optimistic override for whichever period's recap was just generated - keyed so a generate in
  // one period (e.g. regenerating "last month" after switching away) never bleeds into another's
  // display once `reports` catches up via router.refresh().
  const [optimisticRecap, setOptimisticRecap] = useState<{ key: string; content: string } | null>(null)
  const [loadingRecap, setLoadingRecap] = useState(false)
  const currentReport = recapPeriod ? reports.find((r) => r.period_type === recapPeriod.type && r.period_start === recapPeriod.start) : undefined
  const recapKey = recapPeriod ? `${recapPeriod.type}:${recapPeriod.start}` : null
  const displayedRecap = (recapKey && optimisticRecap?.key === recapKey ? optimisticRecap.content : currentReport?.content) ?? null
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [scopeNotes, setScopeNotes] = useState<Record<string, { note: string; clientMessage: string }>>({})
  const [loadingNote, setLoadingNote] = useState<string | null>(null)
  const [copiedScopeMsgId, setCopiedScopeMsgId] = useState<string | null>(null)

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
    if (!recapPeriod) return
    setLoadingRecap(true)
    try {
      const res = await fetch('/api/ai/generate-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, periodType: recapPeriod.type, periodStart: recapPeriod.start }),
      })
      const body = await res.json()
      if (res.ok) {
        setOptimisticRecap({ key: `${recapPeriod.type}:${recapPeriod.start}`, content: body.recap })
        highlightReport(`${recapPeriod.type}:${recapPeriod.start}`)
        router.refresh()
      } else {
        toast.error(body.error || 'Failed to generate recap')
      }
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
        toast.error(body.error || 'Failed to generate')
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
        body: JSON.stringify({ orgId, clientId, periodStart: pMonth, today: todayKey() }),
      })
      const body = await res.json()
      if (res.ok) setScopeNotes((prev) => ({ ...prev, [clientId]: { note: body.note, clientMessage: body.clientMessage } }))
      else toast.error(body.error || 'Failed to generate note')
    } finally {
      setLoadingNote(null)
    }
  }

  async function copyScopeMessage(clientId: string) {
    const message = scopeNotes[clientId]?.clientMessage
    if (!message) return
    try {
      await navigator.clipboard.writeText(message)
      setCopiedScopeMsgId(clientId)
      setTimeout(() => setCopiedScopeMsgId(null), 2000)
    } catch {
      toast.error('Could not copy to clipboard - copy the message manually below')
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

        const byAssignee = new Map<string, { label: string; member: Member | null; count: number }>()
        for (const t of clientTasks) {
          const key = t.assigned_to || 'unassigned'
          const member = t.assigned_to ? members.find((m) => m.user_id === t.assigned_to) ?? null : null
          const label = member ? memberName(member) : 'Unassigned'
          const existing = byAssignee.get(key)
          if (existing) existing.count += 1
          else byAssignee.set(key, { label, member, count: 1 })
        }

        const byLogger = new Map<string, { label: string; member: Member | null; seconds: number }>()
        for (const e of clientEntries) {
          const existing = byLogger.get(e.user_id)
          if (existing) existing.seconds += e.duration_seconds || 0
          else {
            const member = members.find((m) => m.user_id === e.user_id) ?? null
            byLogger.set(e.user_id, { label: memberName(member), member, seconds: e.duration_seconds || 0 })
          }
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
  // without pretending to know a real P&L.
  //
  // A retainer client's revenue for any range is their fair daily share added up one day at a
  // time (smoothedRetainerRevenueCents) - day 1 of the month is worth 1/daysInMonth, and so on.
  // No billing-day cliffs, no separate "spiky $ figure vs smoothed rate proxy" - one number,
  // used for both the displayed revenue and the rate math, whether the range is a week, a month,
  // or the trend chart's trailing window. profitabilityForMonth/Week are thin wrappers over this
  // shared range calc so the rest of the file (which calls them by month-key or week-start) don't
  // need to change.
  function profitabilityForRange(rangeStart: string, rangeEnd: string) {
    const rangeEntries = monthTimeEntries.filter((e) => e.started_at >= rangeStart && e.started_at < rangeEnd)
    // Grouped once per call instead of re-filtering the full charges array per client - this
    // runs once per trend bucket (up to 12 months or 26 weeks), same pattern as Revenue's
    // chargesByClient.
    const chargesByClient = new Map<string, number>()
    for (const ch of monthClientCharges) {
      if (ch.charged_on >= rangeStart && ch.charged_on < rangeEnd) chargesByClient.set(ch.client_id, (chargesByClient.get(ch.client_id) || 0) + ch.amount_cents)
    }
    // Without this, a client who signed up later still shows their full current retainer as
    // revenue in every earlier trend bucket too - flattening the whole trend to "today's roster,
    // replayed backward." A range entirely after they churned is NOT excluded here (a charge
    // billed after they left is still real revenue) - see clientChurnedBefore below instead,
    // which only zeroes the ongoing retainer/hourly portion.
    //
    // A Lead is also excluded - there's no signed contract yet, so any hours logged (discovery
    // calls, prospecting) are pre-sale by definition and have no retainer to be "over-servicing"
    // relative to. Same convention mrrCentsTotal already uses for MRR (excludes Churned and Lead).
    return clients
      .filter((c) => clientExistedBy(c, rangeEnd) && getStage(c) !== 'Lead')
      .map((c) => {
        const clientEntries = rangeEntries.filter((e) => e.client_id === c.id)
        const hours = clientEntries.reduce((s, e) => s + (e.duration_seconds || 0), 0) / 3600
        const isHourly = c.billing_mode === 'hourly'
        const churnedByThisRange = clientChurnedBefore(c, rangeStart)
        const baseRevenueCents = churnedByThisRange
          ? 0
          : isHourly
            ? Math.round((clientEntries.filter((e) => e.billable).reduce((s, e) => s + (e.duration_seconds || 0), 0) / 3600) * (c.hourly_rate_cents || 0))
            : smoothedRetainerRevenueCents(c.retainer_cents || 0, rangeStart, rangeEnd)
        // Extra billables (client_charges) count as revenue same as the Revenue page - a client
        // with a one-off fee that period otherwise reads as less profitable than they actually
        // are, and a final invoice charged after they churned is still real revenue.
        const chargesCents = chargesByClient.get(c.id) || 0
        const revenueCents = baseRevenueCents + chargesCents
        const effectiveRateCents = effectiveRate(revenueCents, hours)
        // Hourly clients used to be excluded here on the theory that their rate is tautologically
        // their contracted hourly_rate_cents - but `hours` is ALL logged hours while `revenueCents`
        // only counts billable ones, so non-billable time dilutes the real effective rate below the
        // nominal one. That's a genuine "are we over-serving this account" signal, not a tautology,
        // so every client with a computable rate gets a delta.
        const rateDeltaCents = effectiveRateCents !== null ? effectiveRateCents - targetRateCents : null
        // Whether the retainer portion shown is less than one full month's amount - true for any
        // week, custom range, or still-in-progress month; false only for a fully-elapsed month
        // that actually earned the whole retainer.
        const isPartialMonth = !isHourly && baseRevenueCents < (c.retainer_cents || 0)
        return { client: c, isHourly, hours, revenueCents, effectiveRateCents, rateDeltaCents, isPartialMonth }
      })
      .filter((r) => r.revenueCents > 0 || r.hours > 0)
      .sort((a, b) => {
        if (a.rateDeltaCents === null) return 1
        if (b.rateDeltaCents === null) return -1
        return a.rateDeltaCents - b.rateDeltaCents
      })
  }

  function profitabilityForMonth(monthKey: string) {
    const { start, end } = monthKeyRange(monthKey)
    return profitabilityForRange(start, end)
  }

  function profitabilityForWeek(weekStart: string) {
    return profitabilityForRange(weekStart, addDays(weekStart, 7))
  }

  const profitability = useMemo(
    () => profitabilityForMonth(pMonth),
    [clients, monthTimeEntries, monthClientCharges, targetRateCents, pMonth],
  )

  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('month')
  const [monthCount, setMonthCount] = useState(6)
  const [weekCount, setWeekCount] = useState(8)

  // Trend chart data for both the "Effective rate" line and the new "Revenue" bar chart - one
  // pass over whichever bucket keys the granularity/count controls pick, entirely client-side
  // (the server always sends a 12-month superset, see reports/page.tsx's trendWindow) so toggling
  // Month/Week or the trailing-count doesn't need a round trip.
  const trendBuckets = useMemo(() => {
    if (trendGranularity === 'month') {
      return trendMonthKeys.slice(-monthCount).map((monthKey) => {
        const perClient = profitabilityForMonth(monthKey)
        const totalRevenueCents = perClient.reduce((s, r) => s + r.revenueCents, 0)
        const totalHours = perClient.reduce((s, r) => s + r.hours, 0)
        return {
          key: monthKey,
          label: monthTick(monthKey),
          fullLabel: monthLabel(`${monthKey}-01`),
          totalRevenueCents,
          // An effective rate needs a denominator - a bucket with retainer revenue but zero
          // logged hours has no *rate* to report, not a rate of $0. null (not 0) so the trend
          // line gaps over it instead of diving to the axis floor and reading as a real, terrible
          // rate.
          blendedRateCents: effectiveRate(totalRevenueCents, totalHours),
          hasData: effectiveRate(totalRevenueCents, totalHours) !== null,
        }
      })
    }
    const isCurrentMonth = pMonth === todayKey().slice(0, 7)
    const [y, m] = pMonth.split('-').map(Number)
    // Weekly buckets anchor on "this week" when pMonth is the current month (the common case),
    // or on the last week of pMonth otherwise - both stay within the server's 12-month window.
    const anchorMonday = isCurrentMonth ? weekAnchor : getWeekAnchor(new Date(y, m, 0))
    return buildWeekKeys(anchorMonday, weekCount).map((weekStart) => {
      const perClient = profitabilityForWeek(weekStart)
      const totalRevenueCents = perClient.reduce((s, r) => s + r.revenueCents, 0)
      const totalHours = perClient.reduce((s, r) => s + r.hours, 0)
      return {
        key: weekStart,
        label: weekTick(weekStart),
        fullLabel: `Week of ${formatDate(weekStart)}`,
        totalRevenueCents,
        blendedRateCents: effectiveRate(totalRevenueCents, totalHours),
        hasData: effectiveRate(totalRevenueCents, totalHours) !== null,
      }
    })
  }, [trendGranularity, monthCount, weekCount, trendMonthKeys, clients, monthTimeEntries, monthClientCharges, targetRateCents, pMonth, weekAnchor])

  function onMonthChange(next: string) {
    router.push(`/reports?pMonth=${next}`)
  }

  function shiftMonth(monthKey: string, delta: number) {
    const [y, m] = monthKey.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  function formatRate(centsPerHour: number) {
    return `${currencySign}${Math.round(centsPerHour / 100).toLocaleString()}/hr`
  }
  function formatRateDelta(centsPerHour: number) {
    const sign = centsPerHour >= 0 ? '+' : '−'
    return `${sign}${currencySign}${Math.round(Math.abs(centsPerHour) / 100).toLocaleString()}/hr`
  }
  function fmtRevenueAxis(cents: number) {
    const dollars = cents / 100
    if (Math.abs(dollars) >= 1000) return `${currencySign}${(dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1)}k`
    return `${currencySign}${Math.round(dollars).toLocaleString()}`
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

  function onRangeChange(next: PeriodValue) {
    const params = new URLSearchParams()
    if (next.period !== 'this_week') params.set('range', next.period)
    if (next.period === 'custom') {
      if (next.start) params.set('start', next.start)
      if (next.end) params.set('end', next.end)
    }
    const qs = params.toString()
    router.push(qs ? `/reports?${qs}` : '/reports')
  }

  return (
    <div>
      <div className="mb-5" data-tour="reports-summary">
        <div className="font-heading text-2xl font-bold text-ink">Reports</div>
        <div className="text-sm text-sage mt-1">Client activity, profitability, team capacity, and the weekly recap library.</div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <nav className="flex flex-wrap md:flex-col gap-1 md:w-40 shrink-0 mb-4 md:mb-0">
          {NAV.map((item) => (
            <button
              key={item.value}
              onClick={() => setView(item.value)}
              className={`relative rounded-full px-3 py-2 text-sm whitespace-nowrap text-left transition-colors ${
                view === item.value ? 'font-medium text-ink' : 'text-sage hover:text-ink hover:bg-sand'
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
        </nav>
        <div className="flex-1 min-w-0">
      {view === 'overview' && (
        <>
          <div className="mb-6">
            <PeriodSelector layoutId="reports-range-active" value={range} onChange={onRangeChange} presets={REPORT_RANGE_PRESETS} />
          </div>

          {recapPeriod && (
            <div className="mb-8" data-tour="reports-recap">
              <div className="text-xs font-semibold tracking-wide text-sage mb-2">
                {recapPeriod.type === 'week' ? 'Weekly' : 'Monthly'} recap
              </div>
              {displayedRecap ? (
                <div className="rounded-2xl bg-white border border-ink/8 border-l-4 border-l-accent p-4">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-xs font-semibold text-sage">{recapPeriod.label}</div>
                    <button className="text-xs text-sage hover:text-ink inline-flex items-center gap-1" onClick={generateRecap} disabled={loadingRecap}>
                      <RefreshIcon size={12} /> Regenerate
                    </button>
                  </div>
                  <div className="text-sm leading-relaxed text-ink">{loadingRecap ? 'Generating…' : displayedRecap}</div>
                </div>
              ) : (
                <button
                  className="w-full rounded-lg border border-ink/10 bg-white py-2 text-sm text-sage shadow-md disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                  onClick={generateRecap}
                  disabled={loadingRecap || !hasApiKey}
                >
                  {loadingRecap ? (
                    <><ClockIcon size={13} /> Generating recap…</>
                  ) : hasApiKey ? (
                    <><SparkleIcon size={13} /> Generate {recapPeriod.type === 'week' ? 'weekly' : 'monthly'} recap</>
                  ) : (
                    'AI features aren’t configured on this deployment'
                  )}
                </button>
              )}
            </div>
          )}

          <div className="mb-8">
            <div className="text-xs font-semibold tracking-wide text-sage mb-2">By client · {rangeLabel}</div>
            {clientReports.length === 0 ? (
              <div className="text-sm text-sage py-3">No task or time activity in this range.</div>
            ) : (
              <div className="@container">
                <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-4">
                  {clientReports.map((r) => {
                    const health = clientHealthKey(r.client, todayKey())
                    return (
                    <Card key={r.client.id}>
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: HEALTH_COLOR[health] }} />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-ink">{r.client.name}</span>
                              <Tooltip content="Contact health - how overdue this client is for a check-in, based on last contact vs. their cadence.">
                                <span className="text-xs font-semibold" style={{ color: HEALTH_COLOR[health] }}>
                                  {HEALTH_LABEL[health]}
                                </span>
                              </Tooltip>
                            </div>
                            <div className="text-xs text-sage mt-0.5">
                              {r.client.last_contacted ? `Last contacted ${formatDate(r.client.last_contacted)}` : 'Never contacted'}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <span className="rounded-full bg-sand/60 text-ink px-2.5 py-1 text-xs font-medium whitespace-nowrap">
                            {r.taskCount} task{r.taskCount !== 1 ? 's' : ''}
                          </span>
                          <span className="rounded-full bg-sand/60 text-ink px-2.5 py-1 text-xs font-medium whitespace-nowrap">
                            {formatDuration(r.totalSeconds)}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                          <div className="text-xs font-semibold tracking-wide text-sage/70 mb-2">Tasks by who</div>
                          {r.byAssignee.length === 0 ? (
                            <div className="text-xs text-sage">-</div>
                          ) : (
                            <div className="space-y-1.5">
                              {r.byAssignee.map((a) => (
                                <div key={a.label} className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {a.member ? (
                                      <Avatar member={a.member} size={18} />
                                    ) : (
                                      <div className="h-[18px] w-[18px] rounded-full bg-sand shrink-0" />
                                    )}
                                    <span className="text-ink truncate">{a.label}</span>
                                  </div>
                                  <span className="text-sage shrink-0 ml-2">{a.count}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-semibold tracking-wide text-sage/70 mb-2">Time by who</div>
                          {r.byLogger.length === 0 ? (
                            <div className="text-xs text-sage">-</div>
                          ) : (
                            <div className="space-y-1.5">
                              {r.byLogger.map((l) => (
                                <div key={l.label} className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {l.member ? (
                                      <Avatar member={l.member} size={18} />
                                    ) : (
                                      <div className="h-[18px] w-[18px] rounded-full bg-sand shrink-0" />
                                    )}
                                    <span className="text-ink truncate">{l.label}</span>
                                  </div>
                                  <span className="text-sage shrink-0 ml-2">{formatDuration(l.seconds)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="text-xs font-semibold tracking-wide text-sage">Report library</div>
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
              <div className="rounded-2xl bg-white border border-ink/8 p-4 mb-4">
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
                    <MonthPicker
                      value={backfillDate.slice(0, 7)}
                      onChange={(v) => setBackfillDate(`${v}-01`)}
                      placeholder="Pick a month…"
                      className="w-44"
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
                        className={`rounded-2xl bg-white border border-ink/8 overflow-hidden transition-shadow ${
                          isJustGenerated ? 'ring-2 ring-accent' : ''
                        }`}
                      >
                        <button
                          className="flex w-full justify-between items-center text-left p-4 hover:bg-sand/60 transition-colors"
                          onClick={() => toggleExpanded(key)}
                        >
                          <span className="text-xs font-semibold text-sage flex items-center gap-2">
                            {reportLabel(r)} <span className="text-sage/50 capitalize">· {r.period_type}</span>
                            {isJustGenerated && (
                              <span className="rounded-full bg-accent/10 text-accent px-2 py-0.5 text-xs font-semibold normal-case">Just generated</span>
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
          <div className="mb-6 flex items-center gap-1 w-fit">
            <button
              type="button"
              className="w-8 h-8 rounded-full border border-ink/10 bg-white shadow-md text-sage hover:text-ink hover:bg-sand/60 transition-colors"
              onClick={() => onMonthChange(shiftMonth(pMonth, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            {/* Click the month itself to jump to any month/year, not just step one at a time. */}
            <MonthPicker value={pMonth} onChange={onMonthChange} className="w-44" disableFuture />
            <button
              type="button"
              className="w-8 h-8 rounded-full border border-ink/10 bg-white shadow-md text-sage hover:text-ink hover:bg-sand/60 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
              onClick={() => onMonthChange(shiftMonth(pMonth, 1))}
              disabled={pMonth >= todayKey().slice(0, 7)}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          {targetRateCents === 0 && (
            <div className="text-sm text-sage bg-white rounded-2xl border border-ink/8 p-3 mb-4">
              Verdolo doesn&apos;t track expenses, so there&apos;s no real cost/margin here - set a target hourly rate in Settings → General to
              see how each account&apos;s effective rate compares (no target set yet).
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 bg-sand/60 rounded-full p-1 w-fit">
              {(['month', 'week'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setTrendGranularity(g)}
                  className={`relative rounded-full px-3 py-1.5 text-sm capitalize transition-colors ${
                    trendGranularity === g ? 'font-medium text-ink' : 'text-sage hover:text-ink'
                  }`}
                >
                  {trendGranularity === g && (
                    <motion.div
                      layoutId="trend-granularity-active"
                      className="absolute inset-0 rounded-full bg-white"
                      style={{ boxShadow: 'inset 2px 0 0 0 var(--accent), 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative">{g === 'month' ? 'By month' : 'By week'}</span>
                </button>
              ))}
            </div>
            <CustomSelect
              value={String(trendGranularity === 'month' ? monthCount : weekCount)}
              onChange={(v) => (trendGranularity === 'month' ? setMonthCount(Number(v)) : setWeekCount(Number(v)))}
              options={(trendGranularity === 'month' ? MONTH_COUNT_OPTIONS : WEEK_COUNT_OPTIONS).map((n) => ({
                value: String(n),
                label: `Last ${n} ${trendGranularity === 'month' ? (n === 1 ? 'month' : 'months') : n === 1 ? 'week' : 'weeks'}`,
              }))}
              className="w-40"
            />
          </div>

          <Card className="mb-6">
            <div className="font-heading text-base font-bold text-ink mb-1">
              Revenue <InfoTooltip content="Total revenue across all clients in each period" />
            </div>
            {trendBuckets.every((b) => b.totalRevenueCents === 0) ? (
              <div className="text-sm text-sage py-3">No revenue yet in this range.</div>
            ) : (
              <BarChart
                labels={trendBuckets.map((b) => b.label)}
                values={trendBuckets.map((b) => b.totalRevenueCents)}
                formatValue={(cents) => fmtRevenueAxis(cents)}
              />
            )}
          </Card>

          <div className="rounded-2xl bg-sand/40 p-3 mb-6 flex flex-col gap-3">
            <Card>
              <div className="text-xs font-semibold tracking-wide text-sage mb-2">
                Effective rate <InfoTooltip content="Revenue divided by hours logged, compared to your target hourly rate" />
              </div>
              {trendGranularity === 'month' && pMonth === todayKey().slice(0, 7) && (
                <div className="text-xs text-sage mb-2">
                  This month&apos;s retainer revenue reflects the days elapsed so far, spread evenly across the month.
                </div>
              )}
              {trendBuckets.every((b) => !b.hasData) ? (
                <div className="text-sm text-sage py-3">No revenue or logged time yet.</div>
              ) : (
                <TrendLineChart
                  months={trendBuckets.map((b) => b.key)}
                  labels={trendBuckets.map((b) => b.label)}
                  formatValue={(cents) => formatRate(cents)}
                  referenceLine={targetRateCents > 0 ? { value: targetRateCents, label: `Target ${formatRate(targetRateCents)}` } : undefined}
                  series={[
                    {
                      key: 'rate',
                      label: 'Effective rate',
                      color: '#898781',
                      values: trendBuckets.map((b) => b.blendedRateCents),
                      pointColors:
                        targetRateCents > 0
                          ? trendBuckets.map((b) => (!b.hasData || b.blendedRateCents === null ? '#c3c2b7' : b.blendedRateCents >= targetRateCents ? '#2a78d6' : '#e05070'))
                          : undefined,
                    },
                  ]}
                />
              )}
            </Card>

            {targetRateCents > 0 && profitability.some((r) => r.rateDeltaCents !== null) && (
              <Card>
                <div className="text-xs font-semibold tracking-wide text-sage mb-2">
                  Effective rate by client · {monthLabel(`${pMonth}-01`)}{' '}
                  <InfoTooltip content="Each client's revenue divided by hours logged, compared to your target hourly rate" />
                </div>
                {pMonth === todayKey().slice(0, 7) && (
                  <div className="text-xs text-sage mb-2">
                    This month&apos;s retainer revenue reflects the days elapsed so far, spread evenly across the month - it&apos;ll reach full value by month end.
                  </div>
                )}
                <DivergingBarChart
                  items={profitability
                    .filter((r) => r.rateDeltaCents !== null)
                    .map((r) => ({ id: r.client.id, label: r.client.name, valueCents: r.rateDeltaCents as number }))
                    .sort((a, b) => b.valueCents - a.valueCents)}
                  formatValue={(cents) => formatRateDelta(cents)}
                />
              </Card>
            )}
          </div>

          <div className="text-xs font-semibold tracking-wide text-sage mb-2">Client detail · {monthLabel(`${pMonth}-01`)}</div>
          {profitability.length === 0 ? (
            <div className="text-sm text-sage py-3">No revenue or logged time in {monthLabel(`${pMonth}-01`)} yet.</div>
          ) : (
            <div className="rounded-2xl bg-white border border-ink/8 overflow-hidden">
              <div className="hidden md:flex items-center gap-4 px-5 py-2.5 border-b border-ink/8 text-[11px] font-semibold uppercase tracking-wide text-sage/70">
                <div className="flex-1">Client</div>
                <div className="w-28 text-right">Revenue</div>
                <div className="w-16 text-right">Hours</div>
                <div className="w-32 text-right">Rate</div>
              </div>
              {profitability.map((r, i) => {
                const isBelowTarget = targetRateCents > 0 && r.rateDeltaCents !== null && r.rateDeltaCents < 0
                return (
                  <div key={r.client.id} className={`px-5 py-3.5 ${i > 0 ? 'border-t border-ink/8' : ''} ${isBelowTarget ? 'bg-red-50/40' : ''}`}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <div className="flex-1 min-w-[160px] flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{r.client.name}</span>
                        {isBelowTarget && (
                          <span className="text-xs rounded-full bg-red-50 text-red-600 px-2 py-0.5 font-semibold inline-flex items-center gap-1 shrink-0">
                            <AlertTriangleIcon size={12} /> Scope creep
                          </span>
                        )}
                      </div>
                      <div className="w-28 text-right shrink-0">
                        <div className="text-xs text-sage tabular-nums">
                          {currencySign}
                          {centsToDollars(r.revenueCents)}
                        </div>
                        <div className="text-[10px] text-sage/60">
                          {r.isHourly ? 'hourly, est.' : r.isPartialMonth ? 'retainer, est., prorated' : 'retainer, est.'}
                        </div>
                      </div>
                      <div className="w-16 text-right text-xs text-sage tabular-nums shrink-0">{r.hours.toFixed(1)}h</div>
                      <div className="w-32 text-right shrink-0">
                        <div className={`text-sm font-semibold tabular-nums ${isBelowTarget ? 'text-red-600' : 'text-ink'}`}>
                          {r.isHourly
                            ? `${currencySign}${centsToDollars(r.client.hourly_rate_cents || 0)}/hr`
                            : r.effectiveRateCents !== null
                              ? formatRate(r.effectiveRateCents)
                              : 'No hours logged'}
                        </div>
                        {!r.isHourly && targetRateCents > 0 && r.rateDeltaCents !== null && (
                          <div className="text-[10px] text-sage/60">{formatRateDelta(r.rateDeltaCents)} vs target</div>
                        )}
                      </div>
                    </div>
                    {isBelowTarget && (
                      <div className="mt-2.5">
                        {scopeNotes[r.client.id] ? (
                          <div className="space-y-2">
                            <div className="text-xs text-ink bg-red-50/60 rounded-lg p-2">{scopeNotes[r.client.id].note}</div>
                            {scopeNotes[r.client.id].clientMessage && (
                              <div className="text-xs bg-sage/10 rounded-lg p-2">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-semibold text-sage tracking-wide text-[10px]">Suggested message to client</span>
                                  <button className="text-sage hover:text-ink underline inline-flex items-center gap-1" onClick={() => copyScopeMessage(r.client.id)}>
                                    {copiedScopeMsgId === r.client.id ? <><CheckIcon size={11} /> Copied</> : 'Copy'}
                                  </button>
                                </div>
                                <div className="text-ink whitespace-pre-wrap">{scopeNotes[r.client.id].clientMessage}</div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            className="text-xs text-sage hover:text-ink underline disabled:opacity-50 inline-flex items-center gap-1"
                            onClick={() => explainScopeCreep(r.client.id)}
                            disabled={loadingNote === r.client.id || !hasApiKey}
                            title={hasApiKey ? undefined : 'AI features aren’t configured on this deployment'}
                          >
                            {loadingNote === r.client.id ? 'Thinking…' : hasApiKey ? <><SparkleIcon size={12} /> Explain with AI</> : 'AI unavailable'}
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
            <Card className="mb-6">
              <div className="font-heading text-base font-bold text-ink mb-3">Hours vs. target · this week</div>
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
            </Card>
          )}

          <div className="text-xs font-semibold tracking-wide text-sage mb-2">Open workload · this week</div>
          {capacity.length === 0 ? (
            <div className="text-sm text-sage py-3">No team members yet.</div>
          ) : (
            <div className="space-y-3">
              {capacity.map((r) => (
                <Card key={r.member.user_id}>
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
                      <div className="flex justify-between text-xs text-sage mb-1">
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
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  )
}
