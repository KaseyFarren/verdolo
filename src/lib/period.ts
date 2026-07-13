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
 * to an in-progress month, so revenue ÷ hours-logged-so-far doesn't spike. Takes an optional
 * `today` override (rather than always reading the local clock) so a server caller can be handed
 * the browser's own todayKey() and stay in agreement with a client-rendered figure it needs to
 * match - the server's runtime timezone otherwise disagrees with the caller's near midnight. */
export function monthElapsedFraction(monthKey: string, today: string = todayKey()): number {
  const todayMonthKey = today.slice(0, 7)
  if (monthKey < todayMonthKey) return 1
  if (monthKey > todayMonthKey) return 0
  const [y, m] = monthKey.split('-').map(Number)
  const dayOfMonth = Number(today.slice(8, 10))
  const daysInMonth = new Date(y, m, 0).getDate()
  return dayOfMonth / daysInMonth
}

/** Fraction of a Monday-anchored week elapsed as of today (1 for a fully past week, 0 for a
 * future one). A retainer's weekly slice (see profitabilityForWeek's weeklyRetainerFraction)
 * assumes a full 7 days of the client's time - for the current, still-in-progress week that
 * overstates revenue against the necessarily-partial hours logged so far, spiking the effective
 * rate as the week starts. Scaling the slice by this fraction keeps both sides of the ratio
 * referring to the same "as of today" window. */
export function weekElapsedFraction(weekStart: string, today: string = todayKey()): number {
  const weekEnd = addDays(weekStart, 7)
  if (weekEnd <= today) return 1
  if (weekStart > today) return 0
  const [wy, wm, wd] = weekStart.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const elapsedDays = Math.round((new Date(ty, tm - 1, td).getTime() - new Date(wy, wm - 1, wd).getTime()) / 86400000) + 1
  return Math.min(1, elapsedDays / 7)
}

/** A full week's fair share of a monthly retainer, as a fraction of the retainer - normally
 * 7/daysInMonth, but a week spanning two calendar months (e.g. Jan 28-Feb 3) would understate
 * or overstate its share if every day were assumed to belong to whichever month weekStart falls
 * in. Sums each day's own 1/daysInThatMonth instead, so a straddling week gets the blended share
 * its 7 days actually add up to. Multiply by weekElapsedFraction for a still-in-progress week. */
export function weeklyRetainerShare(weekStart: string): number {
  let share = 0
  for (let i = 0; i < 7; i++) {
    const [dy, dm] = addDays(weekStart, i).split('-').map(Number)
    share += 1 / daysInMonthOf(dy, dm)
  }
  return share
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

export type BillingCycleProgress = {
  cycleStart: string
  cycleEnd: string
  cycleLengthDays: number
  elapsedDays: number
  fraction: number
}

/** Full detail behind a client's current billing cycle as of today, given the day of the month
 * their retainer renews on (1-31; see clampedBillingDate for how short months are handled).
 * Unlike monthElapsedFraction this doesn't assume every client resets on the 1st: a client
 * billed on the 15th is starting a fresh cycle on the 15th, not the 1st. Counts today as a whole
 * elapsed day (same convention as monthElapsedFraction's dayOfMonth/daysInMonth), so a
 * billing_day of 1 reproduces monthElapsedFraction exactly for clients left at the default. */
export function billingCycleProgress(billingDay: number, today: string = todayKey()): BillingCycleProgress {
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
  return {
    cycleStart: todayKey(cycleStart),
    cycleEnd: todayKey(cycleEnd),
    cycleLengthDays,
    elapsedDays,
    fraction: Math.min(1, Math.max(0, elapsedDays / cycleLengthDays)),
  }
}

/** Fraction of a client's current billing cycle elapsed as of today - see billingCycleProgress
 * for the full breakdown (cycle dates, day counts) this is derived from. */
export function billingCycleElapsedFraction(billingDay: number, today: string = todayKey()): number {
  return billingCycleProgress(billingDay, today).fraction
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
