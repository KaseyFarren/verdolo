import { formatDate, getWeekAnchor, todayKey } from './agency'

export type Period = 'all_time' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom'

export type PeriodValue = {
  period: Period
  // only meaningful when period === 'custom'; both inclusive, YYYY-MM-DD
  start?: string
  end?: string
}

export type PeriodBounds = {
  // inclusive start / exclusive end, YYYY-MM-DD - null means unbounded (all_time)
  start: string | null
  end: string | null
  label: string
}

export const PERIOD_PRESETS: { value: Period; label: string }[] = [
  { value: 'all_time', label: 'All time' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom' },
]

export function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return todayKey(new Date(y, m - 1, d + days))
}

function monthBounds(offsetMonths: number) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1)
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1)
  const start = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return { start, end, label }
}

/** Resolves a PeriodValue into concrete query bounds. `custom` falls back to today if start/end
 * are missing (e.g. picker not yet touched) so callers always get a valid range. */
export function periodBounds(value: PeriodValue): PeriodBounds {
  switch (value.period) {
    case 'all_time':
      return { start: null, end: null, label: 'All time' }
    case 'this_month':
    case 'last_month': {
      const b = monthBounds(value.period === 'this_month' ? 0 : -1)
      return b
    }
    case 'this_week':
    case 'last_week': {
      const thisWeekStart = getWeekAnchor()
      const start = value.period === 'this_week' ? thisWeekStart : addDays(thisWeekStart, -7)
      const end = addDays(start, 7)
      return { start, end, label: `Week of ${formatDate(start)}` }
    }
    case 'custom': {
      const start = value.start || todayKey()
      const endInclusive = value.end || start
      const end = addDays(endInclusive, 1)
      return { start, end, label: start === endInclusive ? formatDate(start) : `${formatDate(start)} – ${formatDate(endInclusive)}` }
    }
  }
}

/** Retainers are monthly figures - only a full-calendar-month period can honestly include them. */
export function isFullCalendarMonth(value: PeriodValue) {
  return value.period === 'this_month' || value.period === 'last_month'
}

/** Fraction of a calendar month elapsed as of today (1 for any month that's fully passed,
 * 0 for a future month). Used to prorate monthly figures like a retainer that get attributed
 * to an in-progress month, so revenue ÷ hours-logged-so-far doesn't spike. */
export function monthElapsedFraction(monthKey: string): number {
  const todayMonthKey = todayKey().slice(0, 7)
  if (monthKey < todayMonthKey) return 1
  if (monthKey > todayMonthKey) return 0
  const [y, m] = monthKey.split('-').map(Number)
  const dayOfMonth = Number(todayKey().slice(8, 10))
  const daysInMonth = new Date(y, m, 0).getDate()
  return dayOfMonth / daysInMonth
}

/** Fraction of a client's current billing cycle elapsed as of today, given the day of the
 * month their retainer renews on (1-28, so every month has that day - no short-month clamping
 * needed). Unlike monthElapsedFraction this doesn't assume every client resets on the 1st: a
 * client billed on the 15th is starting a fresh cycle on the 15th, not the 1st. Counts today as
 * a whole elapsed day (same convention as monthElapsedFraction's dayOfMonth/daysInMonth), so a
 * billing_day of 1 reproduces monthElapsedFraction exactly for clients left at the default. */
export function billingCycleElapsedFraction(billingDay: number, today: string = todayKey()): number {
  const [y, m, d] = today.split('-').map(Number)
  const cycleStartsThisMonth = d >= billingDay
  const cycleStart = cycleStartsThisMonth ? new Date(y, m - 1, billingDay) : new Date(y, m - 2, billingDay)
  const cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, billingDay)
  const now = new Date(y, m - 1, d)
  const cycleLengthDays = Math.round((cycleEnd.getTime() - cycleStart.getTime()) / 86400000)
  const elapsedDays = Math.round((now.getTime() - cycleStart.getTime()) / 86400000) + 1
  return Math.min(1, Math.max(0, elapsedDays / cycleLengthDays))
}
