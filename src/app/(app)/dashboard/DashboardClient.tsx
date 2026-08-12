'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ensureAutoAndRecurringTasks } from '@/lib/taskGen'
import { useTaskTimer } from '@/lib/useTaskTimer'
import Button from '@/components/ui/Button'
import IconButton from '@/components/ui/IconButton'
import Card from '@/components/ui/Card'
import { BUTTON_MOTION } from '@/components/ui/motion'
import { BarChartIcon, CheckIcon, CheckSquareIcon, ClockIcon, PauseIcon, PencilIcon, PlayIcon, RefreshIcon, SparkleIcon, TrashIcon, TrophyIcon } from '@/components/ui/icons'
import AddTaskForm, { type TaskFormState } from '@/components/tasks/AddTaskForm'
import TaskEditForm from '@/components/tasks/TaskEditForm'
import QuickAddTime from '@/components/QuickAddTime'
import InfoTooltip from '@/components/ui/InfoTooltip'
import type { WeekStats } from '@/lib/stats'
import {
  AVATAR_COLORS,
  centsToDollars,
  clientHealthKey,
  currencySymbol,
  formatDate,
  getInitials,
  getOffsetDate,
  getStage,
  formatNoteTime,
  HEALTH_COLOR,
  HEALTH_LABEL,
  memberName,
  priorityColor,
  sortTasks,
  todayKey,
  topByKey,
  type Currency,
} from '@/lib/agency'

type Client = {
  id: string
  name: string
  business: string | null
  platform: string | null
  stage: string | null
  status: string | null
  contract_ends: string | null
  tone: string | null
  awaiting_reply: boolean
  primary_contact_id: string | null
  last_contacted: string | null
  cadence_days: number | null
}
type Task = {
  id: string
  client_id: string | null
  assigned_to: string | null
  title: string
  due_date: string
  priority: string
  notes: string | null
  done: boolean
  completed_at: string | null
  is_auto: boolean
  auto_type: string | null
  skipped: boolean
  recurring_id?: string | null
  default_template_id?: string | null
  parent_task_id?: string | null
}
type Recurring = { id: string; title: string; client_id: string | null; priority: string; frequency: string; notes: string | null }
type DefaultTemplate = { id: string; title: string; priority: string; assigned_to: string | null; notes: string | null; auto_type: string | null; paused: boolean }
type TodayTimeEntry = { user_id: string; client_id: string | null; duration_seconds: number | null }
type WeekTimeEntry = { user_id: string; duration_seconds: number | null }
type WeekCompletedTask = { assigned_to: string | null }
type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null }
type RiskClient = { clientId: string; name: string; riskLevel: 'high' | 'medium'; reason: string; action: string }
type BurnAlert = { clientId: string; name: string; percent: number; status: 'ok' | 'warn' | 'high' | 'over' }

const HEALTH_ORDER = ['green', 'amber', 'red', 'churned'] as const
const MotionLink = motion.create(Link)

function formatHoursMins(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

export default function DashboardClient({
  orgId,
  userId,
  isAdmin,
  monthRevenueCents,
  mrrCents,
  burnAlerts,
  currency,
  initialClients,
  initialTasks,
  initialRecurring,
  initialDefaults,
  todayTimeEntries,
  weekTimeEntries,
  members,
  initialNote,
  hasApiKey,
  excludeWeekends,
  hasRecapThisWeek,
  initialSentToday,
  weekCompletedTasks,
  yourWeekStats,
}: {
  orgId: string
  userId: string
  isAdmin: boolean
  monthRevenueCents: number
  mrrCents: number
  burnAlerts: BurnAlert[]
  currency?: Currency
  initialClients: Client[]
  initialTasks: Task[]
  initialRecurring: Recurring[]
  initialDefaults: DefaultTemplate[]
  todayTimeEntries: TodayTimeEntry[]
  weekTimeEntries: WeekTimeEntry[]
  members: Member[]
  initialNote: string
  hasApiKey: boolean
  excludeWeekends: boolean
  hasRecapThisWeek: boolean
  initialSentToday: string[]
  weekCompletedTasks: WeekCompletedTask[]
  yourWeekStats: WeekStats
}) {
  const supabase = useMemo(() => createClient(), [])
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const timer = useTaskTimer(supabase, orgId, userId)

  // Logs a fixed duration against a task directly, for when someone forgot to run the timer -
  // an already-completed entry (started_at/ended_at both set), not a running one, so it doesn't
  // touch `timer` at all and can't collide with an actually-running timer on the same task.
  async function addManualTimeForTask(task: Task, hours: number) {
    const durationSeconds = Math.round(hours * 3600)
    const endedAt = new Date()
    const startedAt = new Date(endedAt.getTime() - durationSeconds * 1000)
    const { error } = await supabase.from('time_entries').insert({
      org_id: orgId,
      client_id: task.client_id,
      task_id: task.id,
      user_id: userId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      billable: true,
    })
    if (error) toast.error('Failed to log time')
    else toast.success(`${hours}h logged`)
  }

  // router.refresh() (e.g. after the global quick-capture modal adds a task from any page)
  // re-runs the server component and gives us a new initialTasks array, but useState's
  // initializer only runs on mount - without this, the prop update never reaches local state.
  useEffect(() => {
    setTasks(initialTasks)
  }, [initialTasks])

  useEffect(() => {
    ensureAutoAndRecurringTasks(supabase, orgId, initialClients, initialRecurring, initialDefaults, excludeWeekends).then((newRows) => {
      if (!newRows.length) return
      setTasks((prev) => {
        const existingIds = new Set(prev.map((t) => t.id))
        const toAdd = (newRows as Task[]).filter((t) => !existingIds.has(t.id))
        return toAdd.length ? [...prev, ...toAdd] : prev
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [dashDate, setDashDate] = useState(todayKey())
  const [draftMessages, setDraftMessages] = useState<Record<string, string>>({})
  const [focusInputs, setFocusInputs] = useState<Record<string, string>>({})
  const [loadingAll, setLoadingAll] = useState(false)
  const [loadingOne, setLoadingOne] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showMessages, setShowMessages] = useState(true)
  const [sentClientIds, setSentClientIds] = useState<Set<string>>(new Set(initialSentToday))
  const [showAddTask, setShowAddTask] = useState(false)
  const [taskMode, setTaskMode] = useState<'quick' | 'detailed'>('quick')
  const [taskForm, setTaskForm] = useState<TaskFormState>({ title: '', clientId: '', assignedTo: '', dueDate: todayKey(), priority: '', notes: '' })
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, unknown>>({})

  const [analyzingRisk, setAnalyzingRisk] = useState(false)
  const [riskResults, setRiskResults] = useState<RiskClient[] | null>(null)
  const [riskGeneratedAt, setRiskGeneratedAt] = useState<string | null>(null)

  const [note, setNote] = useState(initialNote)
  const [noteSaved, setNoteSaved] = useState(true)
  const noteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function updateNote(value: string) {
    setNote(value)
    setNoteSaved(false)
    if (noteTimeoutRef.current) clearTimeout(noteTimeoutRef.current)
    noteTimeoutRef.current = setTimeout(async () => {
      await supabase.from('quick_notes').upsert({ org_id: orgId, user_id: userId, content: value, updated_at: new Date().toISOString() })
      setNoteSaved(true)
    }, 800)
  }
  useEffect(() => {
    return () => {
      if (noteTimeoutRef.current) clearTimeout(noteTimeoutRef.current)
    }
  }, [])

  const today = todayKey()
  const yesterday = getOffsetDate(-1)
  const tomorrow = getOffsetDate(1)
  const dashIsToday = dashDate === today
  const dashLabel = dashIsToday ? 'Today' : dashDate === yesterday ? 'Yesterday' : 'Tomorrow'

  const activeClients = clients.filter((c) => getStage(c) !== 'Churned')
  const pausedClients = clients.filter((c) => getStage(c) === 'Churned')
  // Header count is deliberately stricter than `activeClients` (which feeds check-in messaging
  // below and just means "not paused") - Lead/Trial clients aren't active client relationships yet.
  const activeStageClients = clients.filter((c) => getStage(c) === 'Active')
  const thirtyDaysOut = getOffsetDate(30)
  const expiringContracts = clients.filter((c) => c.contract_ends && c.contract_ends <= thirtyDaysOut && c.contract_ends >= today && getStage(c) !== 'Churned')

  // Same scope as the header count above - Lead/Trial clients aren't active relationships yet,
  // so they shouldn't pad the "on track" bucket. At Risk/Active/Churned all still count.
  const clientsForHealth = clients.filter((c) => !['Lead', 'Trial'].includes(getStage(c)))
  const clientHealth = HEALTH_ORDER.map((key) => ({
    key,
    count: clientsForHealth.filter((c) => clientHealthKey(c, today) === key).length,
  })).filter((s) => s.count > 0)

  const currencySign = currencySymbol(currency)
  function fmtMoney(cents: number) {
    return `${currencySign}${centsToDollars(cents).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  }

  // Team-today panel: one shared query (page.tsx), RLS does the role-scoping for free -
  // admins/owners get every member's rows back, members only get their own. So the same
  // dataset is either "who logged what today" (admin) or "my time by client today" (member).
  const teamToday = isAdmin
    ? members
        .map((m) => ({
          key: m.user_id,
          label: memberName(m),
          seconds: todayTimeEntries.filter((e) => e.user_id === m.user_id).reduce((s, e) => s + (e.duration_seconds || 0), 0),
        }))
        .filter((r) => r.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
    : clients
        .map((c) => ({
          key: c.id,
          label: c.name,
          seconds: todayTimeEntries.filter((e) => e.client_id === c.id).reduce((s, e) => s + (e.duration_seconds || 0), 0),
        }))
        .filter((r) => r.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)

  // Lightweight team recognition - no notifications/points infra, just this week's leader by
  // hours logged and by tasks completed, computed from data already fetched for other panels.
  const topHours = isAdmin ? topByKey(weekTimeEntries, (e) => e.user_id, (e) => e.duration_seconds || 0) : null
  const topTasks = isAdmin ? topByKey(weekCompletedTasks, (t) => t.assigned_to, () => 1) : null
  const topHoursLabel = topHours ? memberName(members.find((m) => m.user_id === topHours.key)) : null
  const topTasksLabel = topTasks ? memberName(members.find((m) => m.user_id === topTasks.key)) : null

  // Dashboard is everyone's personal "my day" view, not the full org workload (that's the
  // Tasks page) - scope to tasks assigned to me + unassigned/shared ones, even for admins/owners
  // who can otherwise fetch the whole org's tasks.
  const dashTasks = sortTasks(tasks.filter((t) => t.due_date === dashDate && !t.skipped && (t.assigned_to === userId || !t.assigned_to)))
  const dashPending = dashTasks.filter((t) => !t.done)
  const dashPendingMine = dashPending.filter((t) => t.assigned_to !== null)
  const dashPendingUnassigned = dashPending.filter((t) => t.assigned_to === null)
  const dashCompleted = dashTasks.filter((t) => t.done)
  const ringTotal = dashTasks.length
  const ringDone = dashCompleted.length

  function isSentToday(clientId: string) {
    return sentClientIds.has(clientId) || tasks.some((t) => t.client_id === clientId && t.is_auto && t.auto_type === 'checkin' && t.due_date === today && t.done)
  }

  async function addTask() {
    if (!taskForm.title.trim()) return
    const { data } = await supabase
      .from('tasks')
      .insert({
        org_id: orgId,
        title: taskForm.title,
        client_id: taskForm.clientId || null,
        assigned_to: taskForm.assignedTo || (taskMode === 'quick' ? userId : null),
        due_date: taskForm.dueDate,
        priority: taskForm.priority || 'Medium',
        notes: taskForm.notes,
        quick: taskMode === 'quick',
        done: false,
      })
      .select()
      .single()
    if (data) setTasks((prev) => [...prev, data as Task])
    setTaskForm((f) => ({ ...f, title: '', notes: '' }))
    setShowAddTask(false)
  }

  async function updateTask(id: string, fields: Record<string, unknown>) {
    // TaskEditForm's client/assignee selects use '' for "none" (CustomSelect has no concept of
    // null), but client_id/assigned_to are uuid columns - sending '' straight through fails with
    // "invalid input syntax for type uuid" on save, whether or not that's the field you touched.
    const normalized = { ...fields }
    if (normalized.client_id === '') normalized.client_id = null
    if (normalized.assigned_to === '') normalized.assigned_to = null

    // Optimistic: apply the edit and close the editor before the round-trip; roll back on failure.
    let prevTask: Task | undefined
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        prevTask = t
        return { ...t, ...normalized } as Task
      }),
    )
    setEditingTaskId(null)
    const { data, error } = await supabase.from('tasks').update(normalized).eq('id', id).select().single()
    if (error) {
      if (prevTask) setTasks((prev) => prev.map((t) => (t.id === id ? (prevTask as Task) : t)))
      toast.error('Could not save that change')
      return
    }
    if (data) setTasks((prev) => prev.map((t) => (t.id === id ? (data as Task) : t)))
  }

  function deleteTask(id: string) {
    const removed = tasks.find((t) => t.id === id)
    if (!removed) return
    // deleting a parent cascades to its subtasks in the DB (on delete cascade); mirror that in
    // the optimistic local state and Undo path so subtask rows don't linger until the next fetch
    const removedSubtasks = tasks.filter((t) => t.parent_task_id === id)
    // A generated instance (recurring / default / auto) can't be hard-deleted - the generator
    // recreates it on the next load, so the "deleted" task reappears. Mark it skipped instead:
    // it's hidden everywhere, won't count as completed (done stays false), and the surviving row
    // blocks regeneration via the unique constraint. One-off tasks are still truly deleted.
    const isGenerated = !!(removed.recurring_id || removed.is_auto || removed.default_template_id)
    setTasks((prev) => prev.filter((t) => t.id !== id && t.parent_task_id !== id))
    const timeoutId = setTimeout(async () => {
      if (isGenerated) await supabase.from('tasks').update({ skipped: true }).eq('id', id)
      else await supabase.from('tasks').delete().eq('id', id)
    }, 5000)
    toast('Task deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timeoutId)
          setTasks((prev) => [...prev, removed, ...removedSubtasks])
        },
      },
    })
  }

  async function toggleTask(t: Task) {
    const nowDone = !t.done
    if (nowDone) await timer.stopIfRunningFor(t.id)
    // Claiming an unassigned task on completion so it credits the completer's tally instead of
    // vanishing from every per-person breakdown (topByKey skips null assigned_to entirely).
    const claim = nowDone && !t.assigned_to ? { assigned_to: userId } : {}
    // Optimistic: flip the checkbox immediately, roll back if the update fails.
    setTasks((prev) =>
      prev.map((x) => (x.id === t.id ? ({ ...x, done: nowDone, completed_at: nowDone ? new Date().toISOString() : null, ...claim } as Task) : x)),
    )
    const { data, error } = await supabase
      .from('tasks')
      .update({ done: nowDone, completed_at: nowDone ? new Date().toISOString() : null, ...claim })
      .eq('id', t.id)
      .select()
      .single()
    if (error) {
      setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)))
      toast.error('Could not update that task')
      return
    }
    if (data) setTasks((prev) => prev.map((x) => (x.id === t.id ? (data as Task) : x)))
    if (nowDone && t.is_auto && t.auto_type === 'checkin' && t.client_id) {
      await supabase.from('clients').update({ last_contacted: today }).eq('id', t.client_id)
    }
  }

  async function generateAll() {
    setLoadingAll(true)
    try {
      const res = await fetch('/api/ai/daily-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const body = await res.json()
      if (res.ok) {
        const next: Record<string, string> = {}
        for (const m of body.messages || []) {
          const client = clients.find((c) => c.name === m.client)
          if (client) next[client.id] = m.message
        }
        setDraftMessages((prev) => ({ ...prev, ...next }))
      } else {
        toast.error(body.error || 'Generation failed')
      }
    } finally {
      setLoadingAll(false)
    }
  }

  async function generateOne(clientId: string) {
    setLoadingOne(clientId)
    try {
      const res = await fetch('/api/ai/one-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, clientId, todaysFocus: focusInputs[clientId] || '' }),
      })
      const body = await res.json()
      if (res.ok) setDraftMessages((prev) => ({ ...prev, [clientId]: body.message }))
      else toast.error(body.error || 'Generation failed')
    } finally {
      setLoadingOne(null)
    }
  }

  async function analyzeRisk() {
    setAnalyzingRisk(true)
    try {
      const res = await fetch('/api/ai/risk-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const body = await res.json()
      if (res.ok) {
        setRiskResults(body.clients || [])
        setRiskGeneratedAt(body.generatedAt || null)
      } else {
        toast.error(body.error || 'Generation failed')
      }
    } finally {
      setAnalyzingRisk(false)
    }
  }

  async function markSent(client: Client) {
    const message = draftMessages[client.id]
    if (!message) return
    try {
      await navigator.clipboard.writeText(message)
    } catch {
      toast.error('Could not copy to clipboard - copy the message manually below')
    }
    setCopiedId(client.id)
    setTimeout(() => setCopiedId(null), 2000)

    const { error } = await supabase.from('ai_message_log').insert({ org_id: orgId, client_id: client.id, message })
    if (error) return
    setSentClientIds((prev) => new Set(prev).add(client.id))
    await supabase.from('clients').update({ last_contacted: today, awaiting_reply: true }).eq('id', client.id)

    // Best-effort: also close out today's auto-checkin task if one exists, so it drops off
    // the Tasks list - the "Sent" UI above no longer depends on this succeeding.
    const checkin = tasks.find((t) => t.client_id === client.id && t.is_auto && t.auto_type === 'checkin' && (t.due_date === today || (t.due_date < today && !t.done)))
    if (checkin) {
      const claim = checkin.assigned_to ? {} : { assigned_to: userId }
      const { data } = await supabase
        .from('tasks')
        .update({ done: true, completed_at: new Date().toISOString(), ...claim })
        .eq('id', checkin.id)
        .select()
        .single()
      if (data) setTasks((prev) => prev.map((x) => (x.id === checkin.id ? (data as Task) : x)))
    }
  }

  async function undoSent(client: Client) {
    setSentClientIds((prev) => {
      const next = new Set(prev)
      next.delete(client.id)
      return next
    })
    const checkin = tasks.find((t) => t.client_id === client.id && t.is_auto && t.auto_type === 'checkin' && t.due_date === today)
    if (checkin) {
      const { data } = await supabase.from('tasks').update({ done: false, completed_at: null }).eq('id', checkin.id).select().single()
      if (data) setTasks((prev) => prev.map((x) => (x.id === checkin.id ? (data as Task) : x)))
    }
  }

  async function setAwaitingReply(client: Client, value: boolean) {
    // Optimistic: flip the badge immediately, roll back to the captured prior value if the write fails.
    let prev: boolean | undefined
    setClients((cs) =>
      cs.map((c) => {
        if (c.id !== client.id) return c
        prev = c.awaiting_reply
        return { ...c, awaiting_reply: value }
      }),
    )
    const { error } = await supabase.from('clients').update({ awaiting_reply: value }).eq('id', client.id)
    if (error) {
      setClients((cs) => cs.map((c) => (c.id === client.id ? { ...c, awaiting_reply: prev ?? c.awaiting_reply } : c)))
      toast.error('Could not update reply status')
    }
  }
  async function markAwaitingReply(client: Client) {
    await setAwaitingReply(client, true)
  }
  async function clearAwaitingReply(client: Client) {
    await setAwaitingReply(client, false)
  }

  const msgTasksDone = activeClients.filter((c) => isSentToday(c.id)).length

  const rawStatBlocks: ({ key: string; node: React.ReactNode } | null)[] = [
    {
      key: 'team',
      node: (
        <>
          <div className="text-sm font-medium text-ink/60 uppercase tracking-wide mb-2">{isAdmin ? 'Team today' : 'My time today'}</div>
          {teamToday.length === 0 ? (
            <div className="text-sm text-sage">No time logged yet today.</div>
          ) : (
            teamToday.map((r) => (
              <div key={r.key} className="flex justify-between items-center py-1 text-sm">
                <span className="text-ink truncate pr-2">{r.label}</span>
                <span className="font-medium text-ink shrink-0">{formatHoursMins(r.seconds)}</span>
              </div>
            ))
          )}
        </>
      ),
    },
    {
      key: 'yourWeek',
      node: (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-ink/60 uppercase tracking-wide">Your week</div>
            {yourWeekStats.streakDays > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-ink">
                <TrophyIcon size={14} className="shrink-0" /> {yourWeekStats.streakDays} day streak
              </span>
            )}
          </div>
          <div className="flex justify-between items-center py-1 text-sm">
            <span className="text-ink">Tasks completed</span>
            <span className="font-medium text-ink">{yourWeekStats.tasksCompleted}</span>
          </div>
          <div className="flex justify-between items-center py-1 text-sm">
            <span className="text-ink">Hours logged</span>
            <span className="font-medium text-ink">
              {yourWeekStats.hoursLogged.toFixed(1)}h{yourWeekStats.utilizationPercent !== null && ` (${yourWeekStats.utilizationPercent}%)`}
            </span>
          </div>
          {yourWeekStats.medianReplyMinutes !== null && (
            <div className="flex justify-between items-center py-1 text-sm">
              <span className="text-ink">Median reply time</span>
              <span className="font-medium text-ink">{formatHoursMins(Math.round(yourWeekStats.medianReplyMinutes * 60))}</span>
            </div>
          )}
        </>
      ),
    },
    isAdmin && (topHoursLabel || topTasksLabel)
      ? {
          key: 'week',
          node: (
            <>
              <div className="text-sm font-medium text-ink/60 uppercase tracking-wide mb-2">This week</div>
              {topHoursLabel && (
                <div className="flex justify-between items-start gap-2 py-1 text-sm">
                  <span className="text-ink min-w-0 pr-2 inline-flex items-center gap-1.5">
                    <TrophyIcon size={14} className="shrink-0" /> {topHoursLabel} logged the most hours
                  </span>
                  <span className="font-medium text-ink shrink-0">{formatHoursMins(topHours!.total)}</span>
                </div>
              )}
              {topTasksLabel && (
                <div className="flex justify-between items-start gap-2 py-1 text-sm">
                  <span className="text-ink min-w-0 pr-2 inline-flex items-center gap-1.5">
                    <CheckIcon size={14} className="shrink-0" /> {topTasksLabel} completed the most tasks
                  </span>
                  <span className="font-medium text-ink shrink-0">{topTasks!.total}</span>
                </div>
              )}
            </>
          ),
        }
      : null,
    isAdmin
      ? {
          key: 'revenue',
          node: (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-ink/60 uppercase tracking-wide">Revenue</div>
                <MotionLink {...BUTTON_MOTION} href="/revenue" className="inline-flex items-center gap-0.5 text-xs font-medium text-sage hover:text-ink">
                  See more
                </MotionLink>
              </div>
              <div className="flex gap-6">
                <div>
                  <div className="text-xs text-sage mb-0.5">This month</div>
                  <div className="text-xl font-heading font-bold text-ink">{fmtMoney(monthRevenueCents)}</div>
                </div>
                <div>
                  <div className="text-xs text-sage mb-0.5">MRR</div>
                  <div className="text-xl font-heading font-bold text-ink">{fmtMoney(mrrCents)}</div>
                </div>
              </div>
            </>
          ),
        }
      : null,
    isAdmin && burnAlerts.length > 0
      ? {
          key: 'burn',
          node: (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-ink/60 uppercase tracking-wide flex items-center">
                  Retainer burn
                  <InfoTooltip content="Hours logged this billing cycle vs. the hours each retainer supports, at your target hourly rate (Settings → General) unless a client has an explicit included-hours figure." />
                </div>
                <MotionLink {...BUTTON_MOTION} href="/revenue" className="inline-flex items-center gap-0.5 text-xs font-medium text-sage hover:text-ink">
                  See more
                </MotionLink>
              </div>
              <div className="flex flex-col gap-1">
                {burnAlerts.slice(0, 4).map((b) => (
                  <div key={b.clientId} className="flex justify-between items-center py-1 text-sm">
                    <span className="text-ink">{b.name}</span>
                    <span className="font-medium" style={{ color: b.status === 'over' ? '#e05070' : '#cc9a3c' }}>
                      {Math.round(b.percent)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ),
        }
      : null,
    isAdmin
      ? {
          key: 'risk',
          node: (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-ink/60 uppercase tracking-wide flex items-center">
                  At risk
                  <InfoTooltip content="AI-ranked clients with a warning sign - overdue contact, an expiring contract, overdue tasks, or no recent activity." />
                </div>
                <Button variant="ghost" size="sm" onClick={analyzeRisk} disabled={analyzingRisk} className="!px-0">
                  {analyzingRisk ? 'Analyzing…' : riskResults === null ? 'Analyze risk' : 'Re-analyze'}
                </Button>
              </div>
              {riskGeneratedAt && (
                <div className="text-xs text-sage/70 mb-2">
                  As of {formatNoteTime(riskGeneratedAt)} - refreshes automatically after a few hours
                </div>
              )}
              {riskResults === null ? (
                <div className="text-sm text-sage">Not analyzed yet.</div>
              ) : riskResults.length === 0 ? (
                <div className="text-sm text-sage">No clients need attention right now.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {riskResults.map((r) => (
                    <div key={r.clientId} className="rounded-lg border border-ink/10 p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium text-ink">{r.name}</span>
                        <span
                          className="text-xs rounded-full px-2 py-0.5 font-medium shrink-0"
                          style={{ color: r.riskLevel === 'high' ? '#e05070' : '#cc9a3c', background: r.riskLevel === 'high' ? '#e0507015' : '#cc9a3c15' }}
                        >
                          {r.riskLevel === 'high' ? 'High risk' : 'Medium risk'}
                        </span>
                      </div>
                      <div className="text-xs text-sage">{r.reason}</div>
                      <div className="text-xs text-sage mt-1">→ {r.action}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ),
        }
      : null,
    {
      key: 'health',
      node: (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-ink/60 uppercase tracking-wide flex items-center">
              Client health
              <InfoTooltip content="How overdue each client is for a check-in, based on last contact vs. their cadence - separate from pipeline stage (Lead/Trial/Active/etc.)." />
            </div>
            <MotionLink {...BUTTON_MOTION} href="/clients" className="inline-flex items-center gap-0.5 text-xs font-medium text-sage hover:text-ink">
              See more
            </MotionLink>
          </div>
          {clientHealth.length === 0 ? (
            <div className="text-sm text-sage">No clients yet.</div>
          ) : (
            <div className="flex flex-col">
              {clientHealth.map((s) => (
                <div key={s.key} className="flex justify-between items-center py-1 text-sm">
                  <span className="flex items-center gap-2 text-ink">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: HEALTH_COLOR[s.key] }} />
                    {HEALTH_LABEL[s.key]}
                  </span>
                  <span className="font-medium" style={{ color: HEALTH_COLOR[s.key] }}>
                    {s.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ),
    },
  ]
  const statBlocks = rawStatBlocks.filter((block): block is { key: string; node: React.ReactNode } => block !== null)

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="font-heading text-2xl font-bold text-ink">Dashboard</div>
          <div className="text-sm text-sage mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          {activeStageClients.length > 0 && (
            <div className="text-sm text-sage mt-1">
              {activeStageClients.length} active client{activeStageClients.length !== 1 ? 's' : ''}
              {pausedClients.length > 0 && ` (${pausedClients.length} paused)`}
            </div>
          )}
        </div>
        <ProgressRing done={ringDone} total={ringTotal} />
      </div>

      <div className="h-px w-full mb-6 bg-gradient-to-r from-transparent via-ink/10 to-transparent" />

      <div className="flex gap-2 mb-6">
        {[
          ['Yesterday', yesterday],
          ['Today', today],
          ['Tomorrow', tomorrow],
        ].map(([label, date]) => (
          <motion.button
            key={date}
            {...BUTTON_MOTION}
            onClick={() => setDashDate(date)}
            className={`flex-1 rounded-lg py-2 text-sm border transition-colors ${
              dashDate === date ? 'border-accent bg-accent text-white font-medium shadow-md' : 'border-ink/10 bg-white text-sage hover:text-ink'
            }`}
          >
            {label}
          </motion.button>
        ))}
      </div>

      {(expiringContracts.length > 0 || burnAlerts.length > 0 || (dashIsToday && isAdmin)) && (
        <div className="flex flex-col gap-2 mb-6 text-sm">
          {expiringContracts.length > 0 && (
            <span className="text-amber-700">
              Contract{expiringContracts.length !== 1 ? 's' : ''} expiring soon: {expiringContracts.map((c) => `${c.name} (${formatDate(c.contract_ends)})`).join(', ')}
            </span>
          )}
          {burnAlerts.length > 0 && (
            <span className="text-amber-700">
              {burnAlerts.length} client{burnAlerts.length !== 1 ? 's' : ''} over 75% of retainer hours this cycle:{' '}
              {burnAlerts.map((b) => `${b.name} (${Math.round(b.percent)}%)`).join(', ')}
            </span>
          )}
          {dashIsToday && isAdmin && (
            <MotionLink
              {...BUTTON_MOTION}
              href="/reports"
              className="inline-flex items-center gap-1.5 w-fit rounded-full border border-sage/15 bg-sage/8 pl-2.5 pr-3 py-1.5 text-xs font-medium text-sage hover:text-ink hover:bg-sage/12 transition-colors"
            >
              <BarChartIcon size={12} className="shrink-0" />
              {hasRecapThisWeek ? "This week's recap" : 'No recap yet this week'}
             
            </MotionLink>
          )}
        </div>
      )}

      <div className="h-px w-full mb-6 bg-gradient-to-r from-transparent via-ink/10 to-transparent" />

      <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-6">
        <Card className="flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-ink/60 uppercase tracking-wide">{dashLabel}&apos;s tasks</div>
            <Button
              variant="ghost"
              size="sm"
              className="!px-0"
              onClick={() => {
                setShowAddTask((v) => !v)
                if (!showAddTask) setTaskForm((f) => ({ ...f, title: '', notes: '', dueDate: dashDate }))
              }}
            >
              {showAddTask ? 'Cancel' : '+ Add'}
            </Button>
          </div>
          {showAddTask && (
            <AddTaskForm
              mode={taskMode}
              setMode={setTaskMode}
              form={taskForm}
              setForm={setTaskForm}
              clients={clients}
              members={members}
              onSubmit={addTask}
              onCancel={() => setShowAddTask(false)}
            />
          )}
          {dashPending.length === 0 && dashCompleted.length === 0 && !showAddTask ? (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center text-sage">
              <CheckSquareIcon size={22} className="opacity-25" />
              <div className="text-sm">No tasks for {dashLabel.toLowerCase()}.</div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setShowAddTask(true)
                  setTaskForm((f) => ({ ...f, title: '', notes: '', dueDate: dashDate }))
                }}
              >
                + Add a task
              </Button>
            </div>
          ) : (
          <div className="flex-1 min-h-0 max-h-[520px] overflow-y-auto pr-1 -mr-1">
          {dashPendingMine.length > 0 && dashPendingUnassigned.length > 0 && (
            <div className="text-xs font-medium text-sage/70 mb-1">Assigned</div>
          )}
          <AnimatePresence initial={false}>
            {dashPendingMine.map((t) => (
              <SimpleTaskRow
                key={t.id}
                t={t}
                clientName={clients.find((c) => c.id === t.client_id)?.name}
                onToggle={() => toggleTask(t)}
                isTimerRunning={timer.running?.task_id === t.id}
                elapsed={timer.elapsedFor(t.id)}
                startTimer={() => timer.startForTask(t)}
                stopTimer={() => timer.stopRunning()}
                addManualTime={(hours) => addManualTimeForTask(t, hours)}
                isEditing={editingTaskId === t.id}
                editForm={editForm}
                setEditForm={setEditForm}
                clients={clients}
                members={members}
                startEdit={() => {
                  setEditingTaskId(t.id)
                  setEditForm({ title: t.title, client_id: t.client_id || '', assigned_to: t.assigned_to || '', priority: t.priority, due_date: t.due_date, notes: t.notes || '' })
                }}
                cancelEdit={() => setEditingTaskId(null)}
                save={() => updateTask(t.id, editForm)}
                del={() => deleteTask(t.id)}
              />
            ))}
          </AnimatePresence>
          {dashPendingUnassigned.length > 0 && (
            <>
              <div className="text-xs font-medium text-sage/70 mt-3 mb-1">Unassigned</div>
              <AnimatePresence initial={false}>
                {dashPendingUnassigned.map((t) => (
                  <SimpleTaskRow
                    key={t.id}
                    t={t}
                    clientName={clients.find((c) => c.id === t.client_id)?.name}
                    onToggle={() => toggleTask(t)}
                    isTimerRunning={timer.running?.task_id === t.id}
                    elapsed={timer.elapsedFor(t.id)}
                    startTimer={() => timer.startForTask(t)}
                    stopTimer={() => timer.stopRunning()}
                    addManualTime={(hours) => addManualTimeForTask(t, hours)}
                    isEditing={editingTaskId === t.id}
                    editForm={editForm}
                    setEditForm={setEditForm}
                    clients={clients}
                    members={members}
                    startEdit={() => {
                      setEditingTaskId(t.id)
                      setEditForm({ title: t.title, client_id: t.client_id || '', assigned_to: t.assigned_to || '', priority: t.priority, due_date: t.due_date, notes: t.notes || '' })
                    }}
                    cancelEdit={() => setEditingTaskId(null)}
                    save={() => updateTask(t.id, editForm)}
                    del={() => deleteTask(t.id)}
                  />
                ))}
              </AnimatePresence>
            </>
          )}
          {dashCompleted.length > 0 && (
            <>
              <div className="text-xs font-medium text-green/70 mt-4 mb-2">Completed</div>
              {dashCompleted.map((t) => (
                <SimpleTaskRow
                  key={t.id}
                  t={t}
                  clientName={clients.find((c) => c.id === t.client_id)?.name}
                  onToggle={() => toggleTask(t)}
                  isTimerRunning={false}
                  elapsed={null}
                  startTimer={() => {}}
                  stopTimer={() => {}}
                  addManualTime={() => {}}
                  isEditing={editingTaskId === t.id}
                  editForm={editForm}
                  setEditForm={setEditForm}
                  clients={clients}
                  members={members}
                  startEdit={() => {
                    setEditingTaskId(t.id)
                    setEditForm({ title: t.title, client_id: t.client_id || '', assigned_to: t.assigned_to || '', priority: t.priority, due_date: t.due_date, notes: t.notes || '' })
                  }}
                  cancelEdit={() => setEditingTaskId(null)}
                  save={() => updateTask(t.id, editForm)}
                  del={() => deleteTask(t.id)}
                />
              ))}
            </>
          )}
          </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <div className="@container">
            <div className="grid grid-cols-1 @lg:grid-cols-2 gap-4">
              {statBlocks.map((block, i) => {
                const isOddOut = statBlocks.length % 2 === 1 && i === statBlocks.length - 1
                return (
                  <Card key={block.key} className={isOddOut ? '@lg:col-span-2' : ''}>
                    {block.node}
                  </Card>
                )
              })}
            </div>
          </div>

          <Card className="flex flex-col flex-1 min-h-[160px]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-ink/60 uppercase tracking-wide">Quick notes</div>
              <span className="text-xs text-sage">{noteSaved ? 'Saved' : 'Saving…'}</span>
            </div>
            <textarea
              className="flex-1 w-full min-h-[160px] resize-none bg-transparent text-sm text-ink outline-none placeholder:text-sage/60"
              placeholder="Jot something down…"
              value={note}
              onChange={(e) => updateNote(e.target.value)}
            />
          </Card>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-ink/10">
        <div className="flex flex-wrap justify-between items-center gap-y-1 mb-2">
          <button className="flex items-center gap-1.5 text-sm font-medium text-ink/60 hover:text-ink" onClick={() => setShowMessages((v) => !v)}>
            <span className="text-xs">{showMessages ? '▾' : '▸'}</span> Client messages
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-sage">
              {msgTasksDone}/{activeClients.length} sent
            </span>
            {showMessages && hasApiKey && (
              <Button variant="secondary" size="sm" className="text-sage hover:text-ink inline-flex items-center gap-1" onClick={generateAll} disabled={loadingAll}>
                {loadingAll ? 'Writing…' : <><SparkleIcon size={13} /> Generate all</>}
              </Button>
            )}
          </div>
        </div>
        {showMessages && !hasApiKey && <div className="text-sm text-sage py-2">AI check-ins aren&apos;t available right now - try again shortly.</div>}
        {showMessages && activeClients.map((c, i) => {
          const sent = isSentToday(c.id)
          const isGen = loadingOne === c.id
          return (
            <div key={c.id} className={`rounded-2xl p-3 mb-2 ${sent ? 'bg-green/5 border border-green/20' : 'bg-white border border-ink/8'}`}>
              <div className={`flex items-center gap-3 ${sent ? '' : 'mb-2.5'}`}>
                <Avatar name={c.name} index={i} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink">{c.name}</div>
                  <div className="text-xs text-sage">
                    {c.platform || ''}
                    {c.business ? ` · ${c.business}` : ''}
                  </div>
                </div>
                {sent && (
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    <span className="text-green font-semibold inline-flex items-center gap-1">
                      <CheckIcon size={12} /> Sent
                    </span>
                    <Button variant="ghost" size="sm" className="!px-0" onClick={() => undoSent(c)}>
                      Undo
                    </Button>
                    {!c.awaiting_reply && (
                      <motion.button
                        {...BUTTON_MOTION}
                        title="Mark awaiting reply"
                        className="text-amber-700 hover:text-amber-800"
                        onClick={() => markAwaitingReply(c)}
                      >
                        <ClockIcon size={13} />
                      </motion.button>
                    )}
                  </div>
                )}
              </div>
              {/* Gated on awaiting_reply alone, not `sent` - awaiting_reply persists across days, so
                  the day after you send (when sent flips back to false) you can still mark "Got reply". */}
              {c.awaiting_reply && (
                <div className={`flex items-center justify-between bg-amber-100/70 border border-amber-300 rounded-lg px-2.5 py-1.5 ${sent ? 'mt-1' : 'mb-2'}`}>
                  <span className="text-xs text-amber-800 inline-flex items-center gap-1">
                    <ClockIcon size={12} /> Awaiting reply
                  </span>
                  <button className="text-xs text-green font-medium" onClick={() => clearAwaitingReply(c)}>
                    Got reply
                  </button>
                </div>
              )}
              {!sent && (
                <>
                  <input
                    className="w-full rounded-lg border border-ink/10 bg-cream px-3 py-1.5 text-xs mb-2"
                    placeholder="What to cover today… (optional)"
                    value={focusInputs[c.id] || ''}
                    onChange={(e) => setFocusInputs((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isGen && hasApiKey) {
                        e.preventDefault()
                        generateOne(c.id)
                      }
                    }}
                  />
                  {draftMessages[c.id] !== undefined && (
                    <textarea
                      className="w-full rounded-lg border border-ink/10 bg-cream px-3 py-2 text-sm mb-2 min-h-[70px] text-ink"
                      value={isGen ? 'Writing…' : draftMessages[c.id]}
                      onChange={(e) => setDraftMessages((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                  )}
                  <div className="flex gap-2">
                    <Button variant="secondary" size="md" className="text-xs text-sage hover:text-ink inline-flex items-center gap-1" onClick={() => generateOne(c.id)} disabled={isGen || !hasApiKey}>
                      {isGen ? 'Writing…' : draftMessages[c.id] !== undefined ? <RefreshIcon size={13} /> : <><SparkleIcon size={13} /> Generate</>}
                    </Button>
                    {draftMessages[c.id] !== undefined && (
                      <Button variant="primary" size="md" className="flex-1 text-xs inline-flex items-center justify-center gap-1" onClick={() => markSent(c)}>
                        {copiedId === c.id ? <><CheckIcon size={12} /> Copied</> : 'Copy & mark sent'}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProgressRing({ done, total, size = 60 }: { done: number; total: number; size?: number }) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const pct = total === 0 ? 0 : done / total
  const allComplete = total > 0 && done >= total
  const offset = circ - pct * circ
  return (
    <div className="flex flex-col items-center gap-1 w-16 shrink-0">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={allComplete ? '#2a4a2c' : '#e98a4f'} />
            <stop offset="100%" stopColor={allComplete ? '#16271a' : '#dd6b2c'} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(26,26,23,0.08)" strokeWidth={6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ringGradient)"
          strokeWidth={6}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
        {allComplete ? (
          <polyline
            points={`${size * 0.36} ${size * 0.52} ${size * 0.46} ${size * 0.62} ${size * 0.64} ${size * 0.4}`}
            fill="none"
            stroke="#1f3320"
            strokeWidth={size * 0.06}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}
          />
        ) : (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ transform: 'rotate(90deg)', transformOrigin: 'center', fill: '#1a1a17', fontSize: size * 0.2, fontWeight: 700 }}
          >
            {`${done}/${total}`}
          </text>
        )}
      </svg>
    </div>
  )
}

function Avatar({ name, index, size = 30 }: { name: string; index: number; size?: number }) {
  return (
    <div
      className="flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: AVATAR_COLORS[Math.abs(index) % AVATAR_COLORS.length], fontSize: size * 0.4 }}
    >
      {getInitials(name)}
    </div>
  )
}

function SimpleTaskRow({
  t,
  clientName,
  onToggle,
  isTimerRunning,
  elapsed,
  startTimer,
  stopTimer,
  addManualTime,
  isEditing,
  editForm,
  setEditForm,
  clients,
  members,
  startEdit,
  cancelEdit,
  save,
  del,
}: {
  t: Task
  clientName?: string
  onToggle: () => void
  isTimerRunning: boolean
  elapsed: string | null
  startTimer: () => void
  stopTimer: () => void
  addManualTime: (hours: number) => void | Promise<void>
  isEditing: boolean
  editForm: Record<string, unknown>
  setEditForm: (f: (prev: Record<string, unknown>) => Record<string, unknown>) => void
  clients: Client[]
  members: Member[]
  startEdit: () => void
  cancelEdit: () => void
  save: () => void
  del: () => void
}) {
  if (isEditing) {
    return (
      <TaskEditForm
        editForm={editForm}
        setEditForm={setEditForm}
        clients={clients}
        members={members}
        showDueDate={!t.is_auto}
        onCancel={cancelEdit}
        onSave={save}
      />
    )
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: t.done ? 0.45 : 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className={`flex gap-3 items-start py-2 border-b border-ink/10 group ${isTimerRunning ? 'bg-green/5' : ''}`}
    >
      <button
        onClick={onToggle}
        title={isTimerRunning ? 'Mark done - stops the running timer' : undefined}
        className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
          t.done ? 'bg-accent border-accent' : isTimerRunning ? 'border-green ring-2 ring-green/30' : 'border-ink/25'
        }`}
      >
        {t.done && <CheckIcon size={10} className="text-white" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${t.done ? 'line-through text-sage' : 'text-ink'}`}>
          {t.title}
          <span className={`ml-2 text-xs font-medium ${priorityColor(t.priority)}`}>{t.priority}</span>
          {isTimerRunning && (
            <span className="ml-2 text-xs font-mono text-green inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" /> {elapsed}
            </span>
          )}
        </div>
        {clientName && <div className="text-xs text-sage mt-0.5">{clientName}</div>}
      </div>
      <div className={`flex gap-0.5 shrink-0 items-center ${isTimerRunning ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}>
        {!t.done &&
          (isTimerRunning ? (
            <IconButton label="Pause timer" tone="green" icon={<PauseIcon />} onClick={stopTimer} />
          ) : (
            <IconButton label="Start timer" tone="sage" icon={<PlayIcon />} onClick={startTimer} />
          ))}
        {!t.done && !isTimerRunning && <QuickAddTime onAdd={addManualTime} />}
        <IconButton label="Edit" tone="sage" icon={<PencilIcon />} onClick={startEdit} />
        <IconButton label="Delete" tone="red" icon={<TrashIcon />} onClick={del} />
      </div>
    </motion.div>
  )
}
