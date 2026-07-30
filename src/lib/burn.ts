import { billingCycleProgress, type BillingCycleProgress } from './period'

export type BurnStatus = 'ok' | 'warn' | 'high' | 'over'
export const BURN_THRESHOLDS = [75, 90, 100] as const

export function burnStatus(percent: number): BurnStatus {
  if (percent >= 100) return 'over'
  if (percent >= 90) return 'high'
  if (percent >= 75) return 'warn'
  return 'ok'
}

// Hours a retainer client's monthly fee is meant to cover - explicit if the agency sold an hour
// block (retainer_hours), otherwise derived from the retainer amount and the org's target hourly
// rate (the same conversion the scope-creep route already performs). Returns null when there is
// no honest figure to show: hourly clients have no retainer concept, and a retainer client with
// neither an explicit hour figure nor a configured target rate has nothing to derive one from.
export function clientHoursBudget(
  client: { retainer_hours?: number | null; retainer_cents?: number | null; billing_mode?: string | null },
  targetRateCents: number,
): number | null {
  if (client.billing_mode === 'hourly') return null
  if (!client.retainer_cents) return null
  if (client.retainer_hours) return client.retainer_hours
  if (targetRateCents > 0) return client.retainer_cents / targetRateCents
  return null
}

export type ClientBurn = {
  hoursBudget: number
  hoursLogged: number
  percent: number
  status: BurnStatus
  projectedHours: number
  projectedOverageHours: number
  projectedOverageCents: number
  cycle: BillingCycleProgress
}

// Burn is scoped to the client's own billing cycle (billingCycleProgress), not the calendar
// month - a client billed on the 15th is mid-cycle on the 1st, and hours logged so far must
// reflect only that window (see period.ts for why this differs from a flat calendar month).
export function computeClientBurn(
  client: { retainer_hours?: number | null; retainer_cents?: number | null; billing_mode?: string | null; billing_day?: number | null },
  secondsLoggedThisCycle: number,
  targetRateCents: number,
  today?: string,
): ClientBurn | null {
  const hoursBudget = clientHoursBudget(client, targetRateCents)
  if (hoursBudget === null) return null

  const cycle = billingCycleProgress(client.billing_day || 1, today)
  const hoursLogged = secondsLoggedThisCycle / 3600
  const percent = (hoursLogged / hoursBudget) * 100
  // Pace projection mirrors the scope-creep route: if hours keep coming at the same rate for the
  // rest of the cycle, this is where they land - not just where they are today.
  const projectedHours = cycle.fraction > 0 ? hoursLogged / cycle.fraction : hoursLogged
  const projectedOverageHours = Math.max(0, projectedHours - hoursBudget)
  const projectedOverageCents = targetRateCents > 0 ? Math.round(projectedOverageHours * targetRateCents) : 0

  return {
    hoursBudget,
    hoursLogged,
    percent,
    status: burnStatus(percent),
    projectedHours,
    projectedOverageHours,
    projectedOverageCents,
    cycle,
  }
}

export type BurnDriver = { title: string; hours: number; share: number }

// Attributes a cycle's logged hours to the tasks that drove them, so a burn alert can tell a
// concentrated one-off (one task at 60% of the cycle) apart from genuine scope creep (hours
// spread thin across many small items). Entries with no task_id collapse into "Untracked time"
// rather than being dropped - a large untracked share is itself a finding worth surfacing.
export function burnDrivers(
  entries: { task_id?: string | null; duration_seconds?: number | null }[],
  taskTitles: Map<string, string>,
  limit = 3,
): BurnDriver[] {
  const secondsByKey = new Map<string, number>()
  for (const e of entries) {
    const key = e.task_id || 'untracked'
    secondsByKey.set(key, (secondsByKey.get(key) || 0) + (e.duration_seconds || 0))
  }
  const totalSeconds = [...secondsByKey.values()].reduce((s, v) => s + v, 0)
  if (totalSeconds <= 0) return []

  return [...secondsByKey.entries()]
    .map(([key, seconds]) => ({
      title: key === 'untracked' ? 'Untracked time' : taskTitles.get(key) || 'Untitled task',
      hours: seconds / 3600,
      share: seconds / totalSeconds,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, limit)
}
