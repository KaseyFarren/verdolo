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

function daysInMonthOf(year: number, month1indexed: number) {
  return new Date(year, month1indexed, 0).getDate()
}

/** A billing_day up to 31 doesn't exist in every month (Feb, and any 30-day month) - JS's Date
 * constructor silently rolls an out-of-range day into the next month rather than erroring (e.g.
 * `new Date(2026, 3, 31)` becomes May 1, not "April 31"), which would silently corrupt the cycle
 * math. Clamp to the last real day of the given month instead, matching how real billing systems
 * (Stripe included) handle a day-31 subscriber in a 30-day month - bills on the 30th, not next
 * month. daysInMonthOf already returns the right value per-year, so this also self-adjusts for
 * Feb in a leap year without any special-casing. */
function clampedBillingDate(year: number, month1indexed: number, billingDay: number): Date {
  const dim = daysInMonthOf(year, month1indexed)
  return new Date(year, month1indexed - 1, Math.min(billingDay, dim))
}

/** Fraction of a client's current billing cycle elapsed as of today, given the day of the
 * month their retainer renews on (1-31; see clampedBillingDate for how short months are
 * handled). Unlike monthElapsedFraction this doesn't assume every client resets on the 1st: a
 * client billed on the 15th is starting a fresh cycle on the 15th, not the 1st. Counts today as
 * a whole elapsed day (same convention as monthElapsedFraction's dayOfMonth/daysInMonth), so a
 * billing_day of 1 reproduces monthElapsedFraction exactly for clients left at the default. */
export function billingCycleElapsedFraction(billingDay: number, today: string = todayKey()): number {
  const [y, m, d] = today.split('-').map(Number)
  const thisMonthBillingDate = clampedBillingDate(y, m, billingDay)
  const cycleStartsThisMonth = d >= thisMonthBillingDate.getDate()
  let cycleStart: Date
  let cycleEnd: Date
  if (cycleStartsThisMonth) {
    cycleStart = thisMonthBillingDate
    cycleEnd = m === 12 ? clampedBillingDate(y + 1, 1, billingDay) : clampedBillingDate(y, m + 1, billingDay)
  } else {
    cycleStart = m === 1 ? clampedBillingDate(y - 1, 12, billingDay) : clampedBillingDate(y, m - 1, billingDay)
    cycleEnd = thisMonthBillingDate
  }
  const now = new Date(y, m - 1, d)
  const cycleLengthDays = Math.round((cycleEnd.getTime() - cycleStart.getTime()) / 86400000)
  const elapsedDays = Math.round((now.getTime() - cycleStart.getTime()) / 86400000) + 1
  return Math.min(1, Math.max(0, elapsedDays / cycleLengthDays))
}

/** Every renewal date (clamped per clampedBillingDate) that falls within [rangeStart, rangeEnd)
 * - rangeEnd exclusive, both YYYY-MM-DD. A week only ever contains at most one, but a wide custom
 * range can span several, so this returns a list rather than a boolean. Used to recognize a
 * retainer's full value as revenue on the actual day it renews, instead of smoothing it - for
 * any period narrower than a full calendar month, "half a retainer" isn't a real event that
 * happened, but the full renewal on its billing day is. */
export function billingDatesInRange(billingDay: number, rangeStart: string, rangeEnd: string): string[] {
  const dates: string[] = []
  let [y, m] = rangeStart.split('-').map(Number)
  const [endY, endM] = rangeEnd.split('-').map(Number)
  while (y < endY || (y === endY && m <= endM)) {
    const key = todayKey(clampedBillingDate(y, m, billingDay))
    if (key >= rangeStart && key < rangeEnd) dates.push(key)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return dates
}
