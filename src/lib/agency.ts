export const PLATFORMS = ['WhatsApp', 'Email', 'Instagram DM', 'Slack', 'SMS', 'Telegram', 'Other'] as const
export const PRIORITY = ['High', 'Medium', 'Low'] as const
export const TONES = ['Casual', 'Friendly', 'Professional', 'Motivational'] as const
export const STAGES = ['Lead', 'Trial', 'Active', 'At Risk', 'Churned'] as const
export const AVATAR_COLORS = ['#1f3320', '#dd6b2c', '#e98a4f', '#5d6b5c', '#8a6a3c', '#6b8a6e']

export type Stage = (typeof STAGES)[number]
export type Priority = (typeof PRIORITY)[number]

export function stageColor(stage: string) {
  if (stage === 'Lead') return '#c9973c'
  if (stage === 'Trial') return '#cc9a3c'
  if (stage === 'Active') return '#2db87a'
  if (stage === 'At Risk') return '#e05070'
  if (stage === 'Churned') return '#5d6b5c'
  return '#2db87a'
}

export function getStage(client: { stage?: string | null; status?: string | null }): Stage {
  return (client.stage as Stage) || (client.status === 'inactive' ? 'Churned' : 'Active')
}

/** Display-only relabel - the stored/compared value stays 'Churned', users just read "Paused". */
export function stageLabel(stage: string) {
  return stage === 'Churned' ? 'Paused' : stage
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getOffsetDate(offset: number) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return todayKey(d)
}

/** Monday of the current week, stable across all 7 days of that week - unlike getOffsetDate(-7)
 * (a rolling "today minus 7" that shifts daily), this is safe to use as a storage key for
 * once-per-week data like weekly_reports. */
export function getWeekAnchor(d = new Date()) {
  const day = d.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diffToMonday)
  return todayKey(monday)
}

/** Sums `valueFn(item)` per key (via `keyFn`) and returns the highest-total key/value pair -
 * e.g. the teammate with the most hours logged or tasks completed this week. */
export function topByKey<T>(items: T[], keyFn: (item: T) => string | null | undefined, valueFn: (item: T) => number) {
  const totals = new Map<string, number>()
  for (const item of items) {
    const key = keyFn(item)
    if (!key) continue
    totals.set(key, (totals.get(key) ?? 0) + valueFn(item))
  }
  let top: { key: string; total: number } | null = null
  for (const [key, total] of totals) {
    if (total > 0 && (!top || total > top.total)) top = { key, total }
  }
  return top
}

export function formatDate(iso?: string | null) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function formatTime(t?: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`
}

export function getInitials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export function memberName(member?: { display_name?: string | null; invited_email?: string | null } | null) {
  return member?.display_name || member?.invited_email || '-'
}

export function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 }

export function sortTasks<T extends { priority: string; title: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const p = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
    if (p !== 0) return p
    return a.title.localeCompare(b.title)
  })
}

/** green = contacted recently, amber = due for a check-in, red = overdue */
export function getHealthScore(lastContacted: string | null | undefined, today: string, cadenceDays = 7) {
  if (!lastContacted) return 'red'
  const [y, m, d] = lastContacted.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const diff = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000)
  if (diff <= Math.max(1, Math.floor(cadenceDays / 2))) return 'green'
  if (diff <= cadenceDays) return 'amber'
  return 'red'
}

export function mrrCentsTotal(clients: { stage?: string | null; status?: string | null; retainer_cents?: number | null }[]) {
  return clients
    .filter((c) => !['Churned', 'Lead'].includes(getStage(c)))
    .reduce((sum, c) => sum + (Number(c.retainer_cents) || 0), 0)
}

// strips billing amounts before client rows are sent to a browser session that shouldn't see
// revenue - server components serialize all props into the RSC payload regardless of what's
// rendered, so this has to happen before the data leaves the server, not just in the UI
export function stripBillingInfo<T extends { retainer_cents?: number | null; hourly_rate_cents?: number | null }>(clients: T[]): T[] {
  return clients.map((c) => ({ ...c, retainer_cents: null, hourly_rate_cents: null }))
}

// An hourly client's effective rate (revenue ÷ hours) is definitionally their contracted
// hourly_rate_cents, since revenue itself is computed as hours × rate - so a "vs target" delta
// is tautological for them, unlike for a retainer client where it's a real efficiency signal.
// Single flag so Revenue, Reports, and the scope-creep AI note all agree on when that
// comparison means something.
export function isRateComparisonMeaningful(client: { billing_mode?: string | null }) {
  return client.billing_mode !== 'hourly'
}

export function centsToDollars(cents?: number | null) {
  return Math.round((cents ?? 0) / 100)
}

// Hours below this round to "0.0h" everywhere we display them (.toFixed(1)) - a stray few-second
// timer entry (useTaskTimer.ts floors every stopped entry to a minimum of 1 second) can otherwise
// divide revenue by a near-zero denominator and produce a nonsense rate like "$1.4M/hr" while the
// UI still shows "0.0h logged", reading as a bug. Treat sub-threshold hours as "no rate to report."
export const MIN_HOURS_FOR_RATE = 0.05

export function effectiveRate(revenueCents: number, hours: number): number | null {
  return hours >= MIN_HOURS_FOR_RATE ? revenueCents / hours : null
}

export function dollarsToCents(dollars: number | string) {
  return Math.round(Number(dollars || 0) * 100)
}

export type Currency = 'usd' | 'gbp' | 'eur'
export const CURRENCIES: { value: Currency; label: string; symbol: string }[] = [
  { value: 'usd', label: 'USD ($)', symbol: '$' },
  { value: 'gbp', label: 'GBP (£)', symbol: '£' },
  { value: 'eur', label: 'EUR (€)', symbol: '€' },
]

/** Every currency-sensitive display in the app takes an org's `settings.currency` (unset = 'usd',
 * matching pre-currency-preference behavior for every existing org) rather than hardcoding "$" -
 * this is a display/label preference only, not FX conversion; stored cents are never rescaled. */
export function currencySymbol(currency?: string | null): string {
  return CURRENCIES.find((c) => c.value === currency)?.symbol ?? '$'
}

export function formatMoney(cents?: number | null, currency?: string | null) {
  return `${currencySymbol(currency)}${centsToDollars(cents).toLocaleString()}`
}

export function isWeekend(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  return day === 0 || day === 6
}

export function dayOfWeek(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** old app's recurring frequency values: 'daily' | 'weekdays' | 'weekly:0'..'weekly:6' */
export function recurringMatchesDate(frequency: string, iso: string) {
  const d = dayOfWeek(iso)
  if (frequency === 'daily') return true
  if (frequency === 'weekdays') return d > 0 && d < 6
  if (frequency.startsWith('weekly:')) return d === parseInt(frequency.split(':')[1], 10)
  return false
}

export function recurringFrequencyLabel(frequency: string) {
  if (frequency === 'daily') return 'Daily'
  if (frequency === 'weekdays') return 'Weekdays'
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `Weekly – ${days[parseInt(frequency.split(':')[1], 10)] ?? ''}`
}

export function cadenceLabel(days?: number | null) {
  if (!days) return ''
  if (days === 1) return 'Every day'
  if (days === 7) return 'Every week'
  if (days === 14) return 'Every 2 weeks'
  if (days === 30) return 'Every month'
  return `Every ${days} days`
}

export function formatNoteTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
