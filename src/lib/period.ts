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

function daysInMonthOf(year: number, month1indexed: number) {
  return new Date(year, month1indexed, 0).getDate()
}

/** A retainer's fair share of [rangeStart, rangeEnd) (exclusive end, YYYY-MM-DD), a day at a
 * time - day 1 of a month is worth 1/daysInThatMonth of the monthly retainer, day 2 another
 * 1/daysInThatMonth, and so on, correctly blending two different-length months for a range that
 * spans a month boundary (e.g. a week straddling Jan/Feb). Days after `today` haven't happened
 * yet and contribute nothing, so a still-in-progress week/month only ever counts the days
 * actually elapsed - no fictional advance revenue. This is the one place retainer revenue gets
 * attributed to a period anywhere in the app (Reports, the Revenue page, Dashboard's this-month
 * estimate, the AI scope-creep note) - previously each had grown its own proration formula
 * (elapsed-month fraction, elapsed-week fraction × weekly share, billing-cycle fraction, or
 * billing-day "spike" logic) that could quietly disagree with the others for the same client and
 * period. Takes an optional `today` override (rather than always reading the local clock) so a
 * server caller can be handed the browser's own todayKey() and stay in agreement with a
 * client-rendered figure it needs to match - the server's runtime timezone otherwise disagrees
 * with the caller's near midnight. */
export function smoothedRetainerRevenueCents(retainerCents: number, rangeStart: string, rangeEnd: string, today: string = todayKey()): number {
  const tomorrow = addDays(today, 1)
  const cappedEnd = rangeEnd < tomorrow ? rangeEnd : tomorrow
  if (cappedEnd <= rangeStart) return 0
  let total = 0
  for (let cursor = rangeStart; cursor < cappedEnd; cursor = addDays(cursor, 1)) {
    const [y, m] = cursor.split('-').map(Number)
    total += retainerCents / daysInMonthOf(y, m)
  }
  return Math.round(total)
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
 * their retainer renews on (1-31; see clampedBillingDate for how short months are handled). Not
 * used for revenue (see smoothedRetainerRevenueCents) - this is purely "where are we in the
 * cycle the client is actually paying against," for burn/usage tracking (Dashboard, the Revenue
 * page's burn widget, the burn-threshold cron) and the "renews in N days" countdown. */
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

/** Days remaining until a client's retainer next renews, counting today - see billingCycleProgress
 * for the cycle math this is derived from. */
export function daysUntilRenewal(billingDay: number, today: string = todayKey()): number {
  const { cycleLengthDays, elapsedDays } = billingCycleProgress(billingDay, today)
  return cycleLengthDays - elapsedDays + 1
}

/** [start, end) as YYYY-MM-DD for a 'YYYY-MM' month key - end is exclusive, the 1st of the
 * following month. Lets any month-bucketed caller reuse the same day-granularity range checks
 * (clientExistedBy/clientChurnedBefore below) as week/custom-range callers, instead of a second
 * month-key-string comparison with its own boundary rules. */
export function monthKeyRange(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split('-').map(Number)
  const next = new Date(y, m, 1)
  return {
    start: `${monthKey}-01`,
    end: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`,
  }
}

/** Whether a client could have been billing at all before `rangeEnd` (exclusive, YYYY-MM-DD) -
 * false only if they were added on or after it. Used to decide whether a client belongs in a
 * period's breakdown at all, independent of whether they've since churned (a client who churned
 * mid-period can still have real revenue - see clientChurnedBefore, which callers should use to
 * zero *ongoing* retainer/hourly revenue without dropping the client's charges/hours for that
 * period too). One shared definition - Reports (by month and by week) and the Revenue page had
 * each grown a slightly different reimplementation of this, which is how a client got counted in
 * one and silently dropped from another for the same period. */
export function clientExistedBy(client: { added_date?: string | null }, rangeEnd?: string | null): boolean {
  return !client.added_date || !rangeEnd || client.added_date < rangeEnd
}

/** Whether a client had already churned before `rangeStart` (inclusive, YYYY-MM-DD) - true only
 * once churned_at predates the period entirely, so the period they actually churned in still
 * counts. Gates retainer/hourly revenue specifically; never gates client_charges or hours, which
 * are real regardless of billing_mode status (see clientExistedBy doc). */
export function clientChurnedBefore(client: { churned_at?: string | null }, rangeStart?: string | null): boolean {
  return !!client.churned_at && !!rangeStart && client.churned_at < rangeStart
}
