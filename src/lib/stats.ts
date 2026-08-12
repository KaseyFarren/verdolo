import { isWeekend } from './agency'
import { addDays } from './period'

// Personal "Your week" dashboard card - recomputed on every read from rows the caller already
// fetched, same convention as burn.ts. No points/streak table: nothing here is stored, so
// changing the scoring later needs no backfill.

export const POINTS = {
  perTaskCompleted: 10,
  perHourLogged: 5,
  perClientReply: 15,
  utilizationBonusAt100: 25,
}

// Old rows only have `assigned_to`; new/edited rows carry the full `assignee_ids` array - same
// dual-write convention as TasksClient.tsx's effectiveAssignees.
function effectiveAssignees(t: { assigned_to: string | null; assignee_ids?: string[] | null }): string[] {
  return t.assignee_ids?.length ? t.assignee_ids : t.assigned_to ? [t.assigned_to] : []
}

function medianOf(nums: number[]): number | null {
  if (!nums.length) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Messages have no per-row sender-role column - client vs. teammate is only knowable via
// clientUserIds (client_users.user_id for the thread's client). For each thread, walks messages
// in order and pairs each inbound client message with this user's next reply in that thread -
// a reply from a different teammate resets the pending client message without crediting this user.
function computeReplyLatenciesMinutes(
  messages: { thread_id: string; sender_id: string; created_at: string }[],
  userId: string,
  clientUserIds: Set<string>,
): number[] {
  const byThread = new Map<string, { sender_id: string; created_at: string }[]>()
  for (const m of messages) {
    const arr = byThread.get(m.thread_id) ?? []
    arr.push(m)
    byThread.set(m.thread_id, arr)
  }
  const latencies: number[] = []
  for (const msgs of byThread.values()) {
    const sorted = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at))
    let pendingClientAt: string | null = null
    for (const m of sorted) {
      if (clientUserIds.has(m.sender_id)) {
        pendingClientAt = m.created_at
      } else if (pendingClientAt) {
        if (m.sender_id === userId) latencies.push((new Date(m.created_at).getTime() - new Date(pendingClientAt).getTime()) / 60000)
        pendingClientAt = null
      }
    }
  }
  return latencies
}

// Consecutive active days walking back from today. A weekend day never breaks the streak when
// excludeWeekends is on (mirrors the org's own weekend setting), and today itself doesn't break
// it either - the day isn't over yet, so "no activity logged today" shouldn't zero out a streak
// built over the prior days.
function computeStreakDays(activeDates: Set<string>, today: string, excludeWeekends: boolean, maxDays: number): number {
  let streak = 0
  let cursor = today
  for (let i = 0; i < maxDays; i++) {
    if (activeDates.has(cursor)) {
      streak++
      cursor = addDays(cursor, -1)
      continue
    }
    if (cursor === today || (excludeWeekends && isWeekend(cursor))) {
      cursor = addDays(cursor, -1)
      continue
    }
    break
  }
  return streak
}

export type WeekStats = {
  tasksCompleted: number
  hoursLogged: number
  targetHoursPerWeek: number | null
  utilizationPercent: number | null
  medianReplyMinutes: number | null
  repliesHandled: number
  streakDays: number
  points: number
}

export function weekStats(input: {
  userId: string
  today: string
  weekAnchor: string
  excludeWeekends: boolean
  targetHoursPerWeek: number | null
  // History window (e.g. 35 days) of this user's done tasks, org-wide select but only rows this
  // user is an assignee on matter here - the streak needs more than just this week's completions.
  historyTasks: { assigned_to: string | null; assignee_ids?: string[] | null; completed_at: string | null }[]
  // History window of this user's own time entries (already user_id-scoped by the caller's query).
  historyTimeEntries: { started_at: string; duration_seconds: number | null }[]
  // This week's messages in kind='client' threads only.
  weekClientMessages: { thread_id: string; sender_id: string; created_at: string }[]
  clientUserIds: Set<string>
}): WeekStats {
  const { userId, today, weekAnchor, excludeWeekends, targetHoursPerWeek, historyTasks, historyTimeEntries, weekClientMessages, clientUserIds } = input

  const myTasks = historyTasks.filter((t) => effectiveAssignees(t).includes(userId) && t.completed_at)
  const tasksCompleted = myTasks.filter((t) => t.completed_at!.slice(0, 10) >= weekAnchor).length

  const weekEntries = historyTimeEntries.filter((e) => e.started_at.slice(0, 10) >= weekAnchor)
  const hoursLogged = weekEntries.reduce((s, e) => s + (e.duration_seconds ?? 0), 0) / 3600
  const utilizationPercent = targetHoursPerWeek && targetHoursPerWeek > 0 ? Math.round((hoursLogged / targetHoursPerWeek) * 100) : null

  const replyLatencies = computeReplyLatenciesMinutes(weekClientMessages, userId, clientUserIds)
  const medianReplyMinutes = medianOf(replyLatencies)

  const activeDates = new Set<string>()
  for (const t of myTasks) activeDates.add(t.completed_at!.slice(0, 10))
  for (const e of historyTimeEntries) if (e.duration_seconds) activeDates.add(e.started_at.slice(0, 10))
  const streakDays = computeStreakDays(activeDates, today, excludeWeekends, 35)

  const points =
    tasksCompleted * POINTS.perTaskCompleted +
    Math.round(hoursLogged) * POINTS.perHourLogged +
    replyLatencies.length * POINTS.perClientReply +
    (utilizationPercent !== null && utilizationPercent >= 100 ? POINTS.utilizationBonusAt100 : 0)

  return {
    tasksCompleted,
    hoursLogged,
    targetHoursPerWeek,
    utilizationPercent,
    medianReplyMinutes,
    repliesHandled: replyLatencies.length,
    streakDays,
    points,
  }
}
