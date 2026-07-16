'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ensureAutoAndRecurringTasks } from '@/lib/taskGen'
import { markSelfAssigned } from '@/lib/selfNotify'
import { useTaskTimer } from '@/lib/useTaskTimer'
import CustomSelect, { type SelectGroup, type SelectOption } from '@/components/ui/CustomSelect'
import DatePicker from '@/components/ui/DatePicker'
import AddTaskFormMulti from '@/components/tasks/AddTaskFormMulti'
import ImportTasksModal from '@/components/tasks/ImportTasksModal'
import TaskDetailModal from '@/components/tasks/TaskDetailModal'
import Button from '@/components/ui/Button'
import { UploadCloudIcon } from '@/components/ui/icons'
import { PRIORITY, formatDate, getOffsetDate, memberName, recurringFrequencyLabel, sortTasks, todayKey } from '@/lib/agency'
import TaskRow, { TaskListHeader } from '@/components/tasks/TaskRow'

export type Client = { id: string; name: string }
export type Member = {
  user_id: string
  invited_email: string | null
  display_name?: string | null
  avatar_url?: string | null
}
export type Task = {
  id: string
  client_id: string | null
  assigned_to: string | null
  assignee_ids: string[]
  parent_task_id: string | null
  title: string
  due_date: string
  priority: string
  notes: string | null
  done: boolean
  completed_at: string | null
  is_auto: boolean
  auto_type: string | null
  recurring_id: string | null
  default_template_id: string | null
  quick: boolean
  skipped: boolean
}
type Recurring = {
  id: string
  title: string
  client_id: string | null
  assigned_to: string | null
  priority: string
  frequency: string
  notes: string | null
  paused: boolean
}
type Default = {
  id: string
  title: string
  assigned_to: string | null
  priority: string
  notes: string | null
  auto_type: string | null
  paused: boolean
}
type TemplateSubtask = { id: string; template_id: string; title: string; sort_order: number }

const emptyTaskForm = {
  title: '',
  clientId: '',
  assigneeIds: [] as string[],
  dueDate: todayKey(),
  priority: '',
  notes: '',
}
const emptyRecurringForm = {
  title: '',
  clientId: '',
  assignedTo: '',
  priority: 'Medium',
  frequency: 'daily',
  notes: '',
  subtasks: [] as string[],
}
const emptyDefaultForm = {
  title: '',
  assignedTo: '',
  priority: 'Medium',
  notes: '',
  subtasks: [] as string[],
}

// Titles-only editor for the fixed subtask list a default/recurring template generates
// alongside every instance - kept minimal (no priority/assignee per subtask) to match how
// lightweight the rest of these template forms are.
function SubtaskListEditor({ titles, onChange }: { titles: string[]; onChange: (titles: string[]) => void }) {
  const [draft, setDraft] = useState('')
  function commit() {
    if (!draft.trim()) return
    onChange([...titles, draft.trim()])
    setDraft('')
  }
  return (
    <div className="mb-2">
      <div className="text-xs text-sage/70 mb-1">Subtasks</div>
      {titles.map((title, i) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <span className="flex-1 text-sm truncate">{title}</span>
          <button type="button" className="text-xs text-sage hover:text-ink shrink-0" onClick={() => onChange(titles.filter((_, idx) => idx !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
          placeholder="Add a subtask"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        <button type="button" className="text-xs text-sage hover:text-ink shrink-0 px-2" onClick={commit}>
          Add
        </button>
      </div>
    </div>
  )
}

export default function TasksClient({
  orgId,
  userId,
  isAdmin,
  initialClients,
  initialTasks,
  initialRecurring,
  initialDefaults,
  initialDefaultSubtasks,
  initialRecurringSubtasks,
  members,
  excludeWeekends,
}: {
  orgId: string
  userId: string
  isAdmin: boolean
  initialClients: Client[]
  initialTasks: Task[]
  initialRecurring: Recurring[]
  initialDefaults: Default[]
  initialDefaultSubtasks: TemplateSubtask[]
  initialRecurringSubtasks: TemplateSubtask[]
  members: Member[]
  excludeWeekends: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const searchParams = useSearchParams()
  const [view, setView] = useState<'list' | 'calendar' | 'recurring' | 'defaults'>(searchParams.get('view') === 'calendar' ? 'calendar' : 'list')
  const [clients] = useState(initialClients)
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [recurring, setRecurring] = useState<Recurring[]>(initialRecurring)
  const [defaults, setDefaults] = useState<Default[]>(initialDefaults)
  const [defaultSubtasks, setDefaultSubtasks] = useState<TemplateSubtask[]>(initialDefaultSubtasks)
  const [recurringSubtasks, setRecurringSubtasks] = useState<TemplateSubtask[]>(initialRecurringSubtasks)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'due' | 'priority' | 'title' | 'client'>('due')
  const [selectedDate, setSelectedDate] = useState('')
  // Which Done-tab date groups (see doneGroups()) are expanded - starts empty so a history of
  // months' worth of completed tasks doesn't dump onto the screen the moment you open the tab.
  const [expandedDoneGroups, setExpandedDoneGroups] = useState<Set<string>>(new Set())
  const [calMonth, setCalMonth] = useState(todayKey().slice(0, 7))
  const [showAddTask, setShowAddTask] = useState(false)
  const [showImportTasks, setShowImportTasks] = useState(false)
  const [taskMode, setTaskMode] = useState<'quick' | 'detailed'>('quick')
  const [taskForm, setTaskForm] = useState(emptyTaskForm)
  const [addingSubtaskFor, setAddingSubtaskFor] = useState<string | null>(null)
  const [subtaskForm, setSubtaskForm] = useState(emptyTaskForm)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [showAddRecurring, setShowAddRecurring] = useState(false)
  const [recurringForm, setRecurringForm] = useState(emptyRecurringForm)
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null)
  const [editRecurringForm, setEditRecurringForm] = useState<Record<string, unknown>>({})
  const [showAddDefault, setShowAddDefault] = useState(false)
  const [defaultForm, setDefaultForm] = useState(emptyDefaultForm)
  const [editingDefaultId, setEditingDefaultId] = useState<string | null>(null)
  const [editDefaultForm, setEditDefaultForm] = useState<Record<string, unknown>>({})
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

  const today = todayKey()

  // Calendar view defaults to showing today's tasks rather than an empty selection - List
  // view's default (no date pinned, showing the Overdue/Today/Tomorrow buckets) is untouched.
  useEffect(() => {
    if (view === 'calendar' && !selectedDate) setSelectedDate(today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

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

  // Live-sync tasks created/edited/deleted by teammates so this page never needs a manual
  // refresh. Own optimistic changes echo back here too (Postgres Changes fires for the sender
  // as well) - INSERT dedupes by id, UPDATE/DELETE are idempotent against already-applied state.
  useEffect(() => {
    const channel = supabase
      .channel(`tasks-org-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Task
        setTasks((prev) => (prev.some((t) => t.id === incoming.id) ? prev : [...prev, incoming]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Task
        setTasks((prev) => prev.map((t) => (t.id === incoming.id ? incoming : t)))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks', filter: `org_id=eq.${orgId}` }, (payload) => {
        const old = payload.old as { id: string }
        setTasks((prev) => prev.filter((t) => t.id !== old.id))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId, supabase])

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name || ''
  const memberEmail = (id: string | null) => memberName(members.find((m) => m.user_id === id))

  // Old rows only have `assigned_to`; new/edited rows carry the full `assignee_ids` array. This
  // lets every read site treat assignment uniformly without a one-time backfill migration.
  function effectiveAssignees(t: Task): string[] {
    return t.assignee_ids?.length ? t.assignee_ids : t.assigned_to ? [t.assigned_to] : []
  }
  // `assigned_to` (first-selected = primary) keeps getting written alongside `assignee_ids` so
  // pages outside Tasks that only read the single column - Dashboard, Revenue, Reports, Time -
  // keep working unchanged for at least the primary assignee.
  function deriveAssignedTo(ids: string[]): string | null {
    return ids[0] ?? null
  }

  function selectDate(d: string) {
    setSelectedDate(d)
    if (d) setCalMonth(d.slice(0, 7))
  }

  async function addTask() {
    if (!taskForm.title.trim()) return
    const assigneeIds = taskForm.assigneeIds.length ? taskForm.assigneeIds : taskMode === 'quick' ? [userId] : []
    // Supply the id so we can flag a self-assignment before the realtime INSERT echoes back,
    // otherwise NotificationSound could ping you for a task you created yourself.
    const id = crypto.randomUUID()
    if (assigneeIds.includes(userId)) markSelfAssigned(id)
    const insertRow = {
      id,
      org_id: orgId,
      title: taskForm.title,
      client_id: taskForm.clientId || null,
      assignee_ids: assigneeIds,
      assigned_to: deriveAssignedTo(assigneeIds),
      due_date: taskForm.dueDate,
      priority: taskForm.priority || 'Medium',
      notes: taskForm.notes,
      quick: taskMode === 'quick',
      done: false,
    }
    // Optimistic: id is client-generated, so we can show the row and clear the form immediately.
    const optimisticRow: Task = {
      ...insertRow,
      parent_task_id: null,
      completed_at: null,
      is_auto: false,
      auto_type: null,
      recurring_id: null,
      default_template_id: null,
      skipped: false,
    }
    setTasks((prev) => [...prev, optimisticRow])
    setTaskForm(emptyTaskForm)
    setShowAddTask(false)
    const { data, error } = await supabase.from('tasks').insert(insertRow).select().single()
    if (error) {
      setTasks((prev) => prev.filter((t) => t.id !== id))
      toast.error('Could not add that task')
      return
    }
    if (data) setTasks((prev) => prev.map((t) => (t.id === id ? (data as Task) : t)))
  }

  async function addSubtask(parentId: string) {
    if (!subtaskForm.title.trim()) return
    const assigneeIds = subtaskForm.assigneeIds
    const id = crypto.randomUUID()
    if (assigneeIds.includes(userId)) markSelfAssigned(id)
    const insertRow = {
      id,
      org_id: orgId,
      title: subtaskForm.title,
      client_id: subtaskForm.clientId || null,
      assignee_ids: assigneeIds,
      assigned_to: deriveAssignedTo(assigneeIds),
      due_date: subtaskForm.dueDate,
      // subtaskForm's priority starts as '' (emptyTaskForm) and the subtask form has no
      // priority selector to set it, so an unfixed '' here always violated the DB's
      // check(priority in ('High','Medium','Low')) constraint - the insert failed silently,
      // the optimistic row rolled back, and the subtask never actually persisted. Mirror
      // addTask()'s fallback.
      priority: subtaskForm.priority || 'Medium',
      notes: subtaskForm.notes,
      quick: false,
      done: false,
      parent_task_id: parentId,
    }
    const optimisticRow: Task = {
      ...insertRow,
      completed_at: null,
      is_auto: false,
      auto_type: null,
      recurring_id: null,
      default_template_id: null,
      skipped: false,
    }
    setTasks((prev) => [...prev, optimisticRow])
    setSubtaskForm(emptyTaskForm)
    setAddingSubtaskFor(null)
    const { data, error } = await supabase.from('tasks').insert(insertRow).select().single()
    if (error) {
      setTasks((prev) => prev.filter((t) => t.id !== id))
      toast.error('Could not add that subtask')
      return
    }
    if (data) setTasks((prev) => prev.map((t) => (t.id === id ? (data as Task) : t)))
  }

  async function updateTask(id: string, fields: Record<string, unknown>) {
    // Reassigning a task to yourself shouldn't ping you - flag it before the realtime UPDATE echoes.
    if ((Array.isArray(fields.assignee_ids) && (fields.assignee_ids as string[]).includes(userId)) || fields.assigned_to === userId) {
      markSelfAssigned(id)
    }
    // Optimistic: apply the change locally before the round-trip so the UI reacts instantly.
    // Capture the pre-edit row inside the updater (not from the `tasks` closure) so rapid
    // successive edits each roll back to their own true prior state, not a stale snapshot.
    let prevTask: Task | undefined
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        prevTask = t
        return { ...t, ...fields } as Task
      }),
    )
    const { data, error } = await supabase.from('tasks').update(fields).eq('id', id).select().single()
    if (error) {
      // Roll back to the captured pre-edit row and surface the failure.
      if (prevTask) setTasks((prev) => prev.map((t) => (t.id === id ? (prevTask as Task) : t)))
      toast.error('Could not save that change')
      return
    }
    // Reconcile with the server row (picks up any DB-computed fields).
    if (data) setTasks((prev) => prev.map((t) => (t.id === id ? (data as Task) : t)))
  }

  async function completeTask(t: Task) {
    const completedAt = new Date().toISOString()
    await timer.stopIfRunningFor(t.id)
    await updateTask(t.id, { done: true, completed_at: completedAt })
    if (t.is_auto && t.auto_type === 'checkin' && t.client_id) {
      await supabase.from('clients').update({ last_contacted: today }).eq('id', t.client_id)
    }
  }
  async function uncompleteTask(t: Task) {
    await updateTask(t.id, { done: false, completed_at: null })
  }
  async function completeAll(items: Task[]) {
    const pending = items.filter((t) => !t.done)
    for (const t of pending) {
      // A parent can't be marked done while it still has open subtasks (DB trigger
      // guard_parent_completion) - `items` only ever contains top-level tasks (subtasks are
      // excluded from filteredList), so without this the parent's own completeTask call below
      // would silently fail and roll back for any task that still had open subtasks.
      const openSubtasks = (subtasksByParent.get(t.id) || []).filter((s) => !s.done)
      for (const st of openSubtasks) await completeTask(st)
      await completeTask(t)
    }
    if (pending.length) toast.success(`${pending.length} task${pending.length === 1 ? '' : 's'} completed`)
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
  async function snoozeTask(t: Task) {
    await updateTask(t.id, { due_date: getOffsetDate(1), done: false })
  }
  async function skipTask(t: Task) {
    await updateTask(t.id, { done: true, skipped: true })
  }

  async function addRecurring() {
    if (!recurringForm.title.trim()) return
    const { data } = await supabase
      .from('recurring_templates')
      .insert({
        org_id: orgId,
        title: recurringForm.title,
        client_id: recurringForm.clientId || null,
        assigned_to: recurringForm.assignedTo || null,
        priority: recurringForm.priority,
        frequency: recurringForm.frequency,
        notes: recurringForm.notes,
      })
      .select()
      .single()
    if (data) {
      setRecurring((prev) => [...prev, data as Recurring])
      await saveRecurringSubtasks((data as Recurring).id, recurringForm.subtasks)
      await regenerateRecurringInstance(data as Recurring)
    }
    setRecurringForm(emptyRecurringForm)
    setShowAddRecurring(false)
  }
  // Simplest-correct approach: wipe and re-insert rather than diff titles against ids - these
  // template subtask lists are short and edited rarely, so the extra round-trip is a non-issue.
  async function saveRecurringSubtasks(templateId: string, titles: string[]) {
    const clean = titles.map((t) => t.trim()).filter(Boolean)
    await supabase.from('recurring_template_subtasks').delete().eq('template_id', templateId)
    if (clean.length) {
      const { data } = await supabase
        .from('recurring_template_subtasks')
        .insert(clean.map((title, i) => ({ template_id: templateId, title, sort_order: i })))
        .select()
      setRecurringSubtasks((prev) => [...prev.filter((s) => s.template_id !== templateId), ...((data as TemplateSubtask[]) || [])])
    } else {
      setRecurringSubtasks((prev) => prev.filter((s) => s.template_id !== templateId))
    }
  }
  // Regenerates this template's today/tomorrow instance right away (via the same idempotent
  // upsert used on mount) instead of leaving it missing until the next page load.
  async function regenerateRecurringInstance(r: Recurring) {
    await ensureAutoAndRecurringTasks(supabase, orgId, clients, [r], [], excludeWeekends)
    const { data: fresh } = await supabase.from('tasks').select('*').eq('org_id', orgId).eq('archived', false)
    if (fresh) setTasks(fresh as Task[])
  }
  async function updateRecurring(id: string, fields: Record<string, unknown>) {
    // client_id / assigned_to are uuid columns - Postgres rejects '' (the "No client" /
    // "Unassigned" option value), so coerce empty strings to null before writing.
    // subtasks isn't a column on recurring_templates - it's pulled out and saved separately.
    const { subtasks, ...normalized } = fields
    if (normalized.client_id === '') normalized.client_id = null
    if (normalized.assigned_to === '') normalized.assigned_to = null
    const { data } = await supabase.from('recurring_templates').update(normalized).eq('id', id).select().single()
    if (data) setRecurring((prev) => prev.map((r) => (r.id === id ? (data as Recurring) : r)))
    if (Array.isArray(subtasks)) await saveRecurringSubtasks(id, subtasks as string[])
    await supabase.from('tasks').delete().eq('recurring_id', id).eq('done', false).gte('due_date', today)
    if (data && !(data as Recurring).paused) {
      await regenerateRecurringInstance(data as Recurring)
    } else {
      setTasks((prev) => prev.filter((t) => !(t.recurring_id === id && t.due_date >= today && !t.done)))
    }
    setEditingRecurringId(null)
  }
  async function toggleRecurringPaused(r: Recurring) {
    const nextPaused = !r.paused
    const { data } = await supabase.from('recurring_templates').update({ paused: nextPaused }).eq('id', r.id).select().single()
    if (data) setRecurring((prev) => prev.map((x) => (x.id === r.id ? (data as Recurring) : x)))
    if (nextPaused) {
      // pausing hides any not-yet-done instance so it stops showing as pending
      await supabase.from('tasks').delete().eq('recurring_id', r.id).eq('done', false).gte('due_date', today)
      setTasks((prev) => prev.filter((t) => !(t.recurring_id === r.id && t.due_date >= today && !t.done)))
    } else {
      // resuming: regenerate today's/tomorrow's instance right away instead of waiting for next page load
      await regenerateRecurringInstance({ ...r, paused: false })
    }
  }
  async function deleteRecurring(id: string) {
    // tasks.recurring_id is "on delete set null" against recurring_templates, so deleting the
    // template first would null it out on every instance before this could match them - delete
    // the instances first, while recurring_id is still intact, then the template.
    await supabase.from('tasks').delete().eq('recurring_id', id)
    await supabase.from('recurring_templates').delete().eq('id', id)
    setRecurring((prev) => prev.filter((r) => r.id !== id))
    setRecurringSubtasks((prev) => prev.filter((s) => s.template_id !== id))
    setTasks((prev) => prev.filter((t) => t.recurring_id !== id))
  }

  async function addDefault() {
    if (!defaultForm.title.trim()) return
    const { data } = await supabase
      .from('default_task_templates')
      .insert({
        org_id: orgId,
        title: defaultForm.title,
        assigned_to: defaultForm.assignedTo || null,
        priority: defaultForm.priority,
        notes: defaultForm.notes,
      })
      .select()
      .single()
    if (data) {
      setDefaults((prev) => [...prev, data as Default])
      await saveDefaultSubtasks((data as Default).id, defaultForm.subtasks)
      await regenerateDefaultInstance(data as Default)
    }
    setDefaultForm(emptyDefaultForm)
    setShowAddDefault(false)
  }
  // Mirrors saveRecurringSubtasks - wipe and re-insert rather than diff titles against ids.
  async function saveDefaultSubtasks(templateId: string, titles: string[]) {
    const clean = titles.map((t) => t.trim()).filter(Boolean)
    await supabase.from('default_task_template_subtasks').delete().eq('template_id', templateId)
    if (clean.length) {
      const { data } = await supabase
        .from('default_task_template_subtasks')
        .insert(clean.map((title, i) => ({ template_id: templateId, title, sort_order: i })))
        .select()
      setDefaultSubtasks((prev) => [...prev.filter((s) => s.template_id !== templateId), ...((data as TemplateSubtask[]) || [])])
    } else {
      setDefaultSubtasks((prev) => prev.filter((s) => s.template_id !== templateId))
    }
  }
  // Regenerates this template's today/tomorrow instance (one per client) right away instead of
  // leaving it missing until the next page load, mirroring regenerateRecurringInstance above.
  async function regenerateDefaultInstance(d: Default) {
    await ensureAutoAndRecurringTasks(supabase, orgId, clients, [], [d], excludeWeekends)
    const { data: fresh } = await supabase.from('tasks').select('*').eq('org_id', orgId).eq('archived', false)
    if (fresh) setTasks(fresh as Task[])
  }
  async function updateDefault(id: string, fields: Record<string, unknown>) {
    // editDefaultForm seeds assigned_to as '' for "Unassigned" (so CustomSelect has a string to
    // match against its own '' option) - sent as-is, Postgres rejects '' for the uuid column
    // (22P02) and the save silently no-ops, discarding the whole edit with no error shown.
    // subtasks isn't a column on default_task_templates - it's pulled out and saved separately.
    const { subtasks, ...rest } = fields
    const sanitized = { ...rest, assigned_to: rest.assigned_to || null }
    const { data, error } = await supabase.from('default_task_templates').update(sanitized).eq('id', id).select().single()
    if (error) {
      toast.error('Could not save changes - try again')
      return
    }
    if (data) setDefaults((prev) => prev.map((d) => (d.id === id ? (data as Default) : d)))
    if (Array.isArray(subtasks)) await saveDefaultSubtasks(id, subtasks as string[])
    await supabase.from('tasks').delete().eq('default_template_id', id).eq('done', false).gte('due_date', today)
    if (data && !(data as Default).paused) {
      await regenerateDefaultInstance(data as Default)
    } else {
      setTasks((prev) => prev.filter((t) => !(t.default_template_id === id && t.due_date >= today && !t.done)))
    }
    setEditingDefaultId(null)
  }
  async function toggleDefaultPaused(d: Default) {
    const nextPaused = !d.paused
    const { data } = await supabase.from('default_task_templates').update({ paused: nextPaused }).eq('id', d.id).select().single()
    if (data) setDefaults((prev) => prev.map((x) => (x.id === d.id ? (data as Default) : x)))
    if (nextPaused) {
      await supabase.from('tasks').delete().eq('default_template_id', d.id).eq('done', false).gte('due_date', today)
      setTasks((prev) => prev.filter((t) => !(t.default_template_id === d.id && t.due_date >= today && !t.done)))
    } else {
      await regenerateDefaultInstance({ ...d, paused: false })
    }
  }
  async function deleteDefault(id: string) {
    // same ordering hazard as deleteRecurring above: default_template_id is "on delete set
    // null" against default_task_templates, so instances must be cleared first.
    await supabase.from('tasks').delete().eq('default_template_id', id).eq('done', false)
    await supabase.from('default_task_templates').delete().eq('id', id)
    setDefaults((prev) => prev.filter((d) => d.id !== id))
    setDefaultSubtasks((prev) => prev.filter((s) => s.template_id !== id))
    setTasks((prev) => prev.filter((t) => !(t.default_template_id === id && !t.done)))
  }

  // skipped instances stay in the DB (so the recurring-instance upsert won't regenerate them)
  // but are hidden everywhere in the UI - they weren't actually done, just dismissed.
  // Subtasks are excluded from the top-level list/bucket flow - they render nested under their
  // parent row instead (see subtasksByParent below).
  const visible = tasks.filter((t) => !t.skipped && !t.parent_task_id)
  const overdueCount = visible.filter((t) => t.due_date < today && !t.done).length

  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (t.parent_task_id && !t.skipped) {
        const arr = map.get(t.parent_task_id) || []
        arr.push(t)
        map.set(t.parent_task_id, arr)
      }
    }
    return map
  }, [tasks])

  // captures the assignee/client dimension of the current filter selection only - the
  // date/done-status dimension (today/overdue/completed/all) is handled separately below,
  // since those two dimensions compose independently (e.g. a pinned date + an assignee filter)
  function matchesFilter(t: Task): boolean {
    if (filter === 'assignee:mine') return effectiveAssignees(t).includes(userId)
    if (filter === 'assignee:unassigned') return effectiveAssignees(t).length === 0
    if (filter.startsWith('assignee:')) return effectiveAssignees(t).includes(filter.slice('assignee:'.length))
    if (filter !== 'all' && filter !== 'today' && filter !== 'overdue' && filter !== 'completed') return t.client_id === filter
    return true
  }

  function tasksForDate(date: string) {
    return visible.filter((t) => t.due_date === date && matchesFilter(t) && (filter !== 'completed' || t.done))
  }

  // No more date-bucket section headers (Overdue/Today/Tomorrow/...) - overdue tasks get an
  // inline warning icon on their row instead (see TaskRow), and ordering is controlled by the
  // Sort by dropdown. Completed tasks always sort to the bottom unless the Done filter is picked.
  function applySort(items: Task[]): Task[] {
    const sorted = [...items]
    if (sortBy === 'due') sorted.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.title.localeCompare(b.title))
    else if (sortBy === 'priority') return applyDoneLast(sortTasks(sorted))
    else if (sortBy === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title))
    else if (sortBy === 'client') sorted.sort((a, b) => clientName(a.client_id).localeCompare(clientName(b.client_id)) || a.title.localeCompare(b.title))
    return applyDoneLast(sorted)
  }
  // stable sort - only reorders across the done/not-done boundary, preserves the primary sort's
  // relative order within each group
  function applyDoneLast(items: Task[]): Task[] {
    if (filter === 'completed') return items
    return [...items].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1))
  }

  function filteredTasks(): Task[] {
    let items: Task[]
    if (selectedDate) items = tasksForDate(selectedDate)
    else if (filter === 'overdue') items = visible.filter((t) => t.due_date < today && !t.done)
    else if (filter === 'today') items = visible.filter((t) => t.due_date === today && !t.done)
    else if (filter === 'completed') items = visible.filter((t) => t.done)
    // Every other tab is the "working list" - completed tasks leave it immediately rather than
    // sorting to the bottom, so months of finished history don't turn it into endless scroll.
    // Full history lives in the dedicated, grouped Done tab (filter === 'completed') below.
    else items = visible.filter((t) => matchesFilter(t) && !t.done)
    return applySort(items)
  }

  const DONE_GROUP_ORDER = ['today', 'yesterday', 'this-week']
  // Buckets completed tasks by completed_at into Today / Yesterday / This week, then a group per
  // calendar month for anything older - so a huge Done history reads as a handful of collapsible
  // groups instead of one flat, endless list. `items` is expected pre-sorted (applySort already
  // ran in filteredTasks()); order is preserved within each group.
  function doneGroups(items: Task[]): { key: string; label: string; tasks: Task[] }[] {
    const map = new Map<string, { label: string; tasks: Task[] }>()
    for (const t of items) {
      const dateStr = (t.completed_at || t.due_date).slice(0, 10)
      let key: string
      let label: string
      if (dateStr === today) {
        key = 'today'
        label = 'Today'
      } else if (dateStr === getOffsetDate(-1)) {
        key = 'yesterday'
        label = 'Yesterday'
      } else if (dateStr > getOffsetDate(-7)) {
        key = 'this-week'
        label = 'This week'
      } else {
        key = dateStr.slice(0, 7)
        label = new Date(`${key}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      }
      const group = map.get(key) || { label, tasks: [] }
      group.tasks.push(t)
      map.set(key, group)
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        const ai = DONE_GROUP_ORDER.indexOf(a)
        const bi = DONE_GROUP_ORDER.indexOf(b)
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        return b.localeCompare(a) // month keys (YYYY-MM) descending - most recent month first
      })
      .map(([key, group]) => ({ key, ...group }))
  }
  function toggleDoneGroup(key: string) {
    setExpandedDoneGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const filteredList = filteredTasks()
  const detailTask = detailTaskId ? tasks.find((t) => t.id === detailTaskId) ?? null : null
  // members only ever fetch their own + unassigned tasks (RLS-scoped); split those apart with
  // a header so "shared/unclaimed" work reads distinctly from "assigned to me". Admins/owners
  // see everyone's tasks flat (each row already shows its assignee) and use the chips instead.
  function splitBucket(items: Task[]) {
    if (isAdmin) return { mine: items, unassigned: [] as Task[] }
    return {
      mine: items.filter((t) => effectiveAssignees(t).length > 0),
      unassigned: items.filter((t) => effectiveAssignees(t).length === 0),
    }
  }

  function renderTaskRow(t: Task, opts?: { isSubtask?: boolean }) {
    const isSubtask = opts?.isSubtask ?? false
    const childSubtasks = isSubtask ? [] : subtasksByParent.get(t.id) || []
    return (
      <TaskRow
        key={t.id}
        t={t}
        clients={clients}
        members={members}
        updateField={(field, value) => {
          if (field === 'assignee_ids') {
            const assigneeIds = value as string[]
            updateTask(t.id, { assignee_ids: assigneeIds, assigned_to: deriveAssignedTo(assigneeIds) })
          } else if (field === 'client_id') {
            // client_id is a uuid column - Postgres rejects '' (CustomSelect's "No client" value)
            updateTask(t.id, { client_id: (value as string) || null })
          } else {
            updateTask(t.id, { [field]: value })
          }
        }}
        onOpenDetail={() => setDetailTaskId(t.id)}
        complete={() => completeTask(t)}
        uncomplete={() => uncompleteTask(t)}
        del={() => deleteTask(t.id)}
        snooze={() => snoozeTask(t)}
        skip={t.is_auto || t.recurring_id ? () => skipTask(t) : undefined}
        isTimerRunning={timer.running?.task_id === t.id}
        elapsed={timer.elapsedFor(t.id)}
        startTimer={() => timer.startForTask(t)}
        stopTimer={() => timer.stopRunning()}
        addManualTime={(hours) => addManualTimeForTask(t, hours)}
        isSubtask={isSubtask}
        subtasks={childSubtasks}
        subtaskRows={!isSubtask ? childSubtasks.map((st) => renderTaskRow(st, { isSubtask: true })) : undefined}
        isAddingSubtask={!isSubtask && addingSubtaskFor === t.id}
        onAddSubtask={
          isSubtask
            ? undefined
            : () => {
                setAddingSubtaskFor(t.id)
                setSubtaskForm({ ...emptyTaskForm, clientId: t.client_id || '', dueDate: t.due_date })
              }
        }
        addSubtaskForm={
          !isSubtask && addingSubtaskFor === t.id ? (
            <AddTaskFormMulti
              mode="quick"
              setMode={() => {}}
              forceDetailed
              form={subtaskForm}
              setForm={setSubtaskForm}
              clients={clients}
              members={members}
              onSubmit={() => addSubtask(t.id)}
              onCancel={() => setAddingSubtaskFor(null)}
              submitLabel="Add subtask"
            />
          ) : undefined
        }
      />
    )
  }

  const filterOptions: SelectOption[] = [
    { value: 'all', label: 'All' },
    { value: 'today', label: 'Today' },
    {
      value: 'overdue',
      label: overdueCount > 0 ? `Overdue (${overdueCount})` : 'Overdue',
    },
    { value: 'completed', label: 'Done' },
    ...(isAdmin
      ? [
          { value: 'assignee:mine', label: 'Mine' },
          { value: 'assignee:unassigned', label: 'Unassigned' },
        ]
      : []),
  ]
  const filterGroups: SelectGroup[] = [
    ...(isAdmin && members.filter((m) => m.user_id !== userId).length > 0
      ? [
          {
            label: 'Team',
            options: members
              .filter((m) => m.user_id !== userId)
              .map((m) => ({
                value: `assignee:${m.user_id}`,
                label: memberName(m),
              })),
          },
        ]
      : []),
    ...(clients.length > 0
      ? [
          {
            label: 'Clients',
            options: clients.map((c) => ({ value: c.id, label: c.name })),
          },
        ]
      : []),
  ]
  const filterSelect = <CustomSelect value={filter} onChange={setFilter} options={filterOptions} groups={filterGroups} className="w-36" />
  const sortOptions: SelectOption[] = [
    { value: 'due', label: 'Sort: Due date' },
    { value: 'priority', label: 'Sort: Priority' },
    { value: 'title', label: 'Sort: Title' },
    { value: 'client', label: 'Sort: Client' },
  ]
  const sortSelect = <CustomSelect value={sortBy} onChange={(v) => setSortBy(v as typeof sortBy)} options={sortOptions} className="w-36" />

  const [calY, calM] = calMonth.split('-').map(Number)
  const jsMonth = calM - 1
  const firstDay = new Date(calY, jsMonth, 1).getDay()
  const daysInMonth = new Date(calY, jsMonth + 1, 0).getDate()

  function prevMonth() {
    const d = new Date(calY, jsMonth - 1, 1)
    setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  function nextMonth() {
    const d = new Date(calY, jsMonth + 1, 1)
    setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const TASK_NAV: { value: typeof view; label: string }[] = [
    { value: 'list', label: 'List' },
    { value: 'calendar', label: 'Calendar' },
    { value: 'recurring', label: 'Recurring' },
    { value: 'defaults', label: 'Defaults' },
  ]

  const headerAction =
    view === 'recurring'
      ? { open: showAddRecurring, onClick: () => setShowAddRecurring(true) }
      : view === 'defaults'
        ? { open: showAddDefault, onClick: () => setShowAddDefault(true) }
        : {
            open: showAddTask,
            onClick: () => {
              setShowAddTask(true)
              setTaskForm((f) => ({ ...emptyTaskForm, dueDate: selectedDate || todayKey(), title: f.title }))
            },
          }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-5">Tasks</h1>

      <div className="flex flex-col md:flex-row gap-6">
        <nav className="flex flex-wrap md:flex-col gap-1 md:w-40 shrink-0 mb-4 md:mb-0">
          {TASK_NAV.map((item) => (
            <button
              key={item.value}
              onClick={() => {
                setView(item.value)
                setShowAddTask(false)
              }}
              className={`relative rounded-full px-3 py-2 text-sm whitespace-nowrap text-left transition-colors ${
                view === item.value ? 'font-medium text-ink' : 'text-sage hover:text-ink hover:bg-sand'
              }`}
            >
              {view === item.value && (
                <motion.div
                  layoutId="tasks-nav-active"
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
          {/* Always rendered in the same spot on all four tabs - the "+ New task" button never
              moves or changes as you switch tabs; only the controls to its left change. The tour
              spotlights this whole region so the add form lights up as it opens. */}
          <div data-tour="add-task-region">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex flex-wrap items-center gap-2">
                {view === 'list' && <DatePicker value={selectedDate} onChange={selectDate} placeholder="Pick a date…" className="w-40" />}
                {(view === 'list' || view === 'calendar') && filterSelect}
                {view === 'list' && sortSelect}
              </div>
              {/* invisible (not unmounted) when hidden so the row height stays constant as the add-form opens/closes */}
              <div className={`flex items-center gap-2 ${headerAction.open ? 'invisible pointer-events-none' : ''}`}>
                {view === 'list' && (
                  <Button variant="secondary" size="lg" className="rounded-full" onClick={() => setShowImportTasks(true)}>
                    <span className="inline-flex items-center gap-1.5">
                      <UploadCloudIcon size={14} />
                      Import from doc
                    </span>
                  </Button>
                )}
                <Button variant="primary" size="lg" className="rounded-full" data-tour="add-task-button" onClick={headerAction.onClick}>
                  + New task
                </Button>
              </div>
            </div>

            {view === 'list' && showAddTask && (
              <AddTaskFormMulti mode={taskMode} setMode={setTaskMode} form={taskForm} setForm={setTaskForm} clients={clients} members={members} onSubmit={addTask} onCancel={() => setShowAddTask(false)} />
            )}
          </div>

          {showImportTasks && (
            <ImportTasksModal
              supabase={supabase}
              orgId={orgId}
              clients={clients}
              onImported={(newTasks) => setTasks((prev) => [...prev, ...newTasks])}
              onClose={() => setShowImportTasks(false)}
            />
          )}

          {detailTask && (
            <TaskDetailModal
              task={detailTask}
              clients={clients}
              members={members}
              effectiveAssignees={effectiveAssignees}
              onSave={(fields) => updateTask(detailTask.id, { ...fields, assigned_to: deriveAssignedTo(fields.assignee_ids) })}
              onDelete={() => {
                deleteTask(detailTask.id)
                setDetailTaskId(null)
              }}
              onClose={() => setDetailTaskId(null)}
            />
          )}

          {view === 'calendar' && (
            <>
              <div className="rounded-lg border border-ink/10 bg-white p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <button onClick={prevMonth} className="text-sage px-2">
                    ‹
                  </button>
                  <div className="text-sm font-medium">
                    {new Date(calY, jsMonth).toLocaleDateString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </div>
                  <button onClick={nextMonth} className="text-sage px-2">
                    ›
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                    <div key={i} className="text-center text-xs text-sage py-1">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {Array(firstDay)
                    .fill(null)
                    .map((_, i) => (
                      <div key={'e' + i} />
                    ))}
                  {Array(daysInMonth)
                    .fill(null)
                    .map((_, i) => {
                      const d = i + 1
                      const k = `${calY}-${String(jsMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                      const isToday = k === today
                      const isSel = k === selectedDate
                      const cnt = tasksForDate(k).filter((t) => !t.done).length
                      return (
                        <div key={d} onClick={() => selectDate(k)} className={`text-center py-1.5 rounded-full cursor-pointer ${isSel ? 'bg-accent text-white' : isToday ? 'bg-ink/5' : ''}`}>
                          <div className={`text-sm ${isSel ? 'font-semibold' : isToday ? 'text-accent font-medium' : ''}`}>{d}</div>
                          {cnt > 0 && <div className={`h-1 w-1 rounded-full mx-auto mt-0.5 ${isSel ? 'bg-white/80' : 'bg-ink/40'}`} />}
                        </div>
                      )
                    })}
                </div>
              </div>

              {selectedDate && (
                <>
                  <div className="text-sm font-medium mb-2">{formatDate(selectedDate)}</div>

                  {showAddTask && (
                    <AddTaskFormMulti
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

                  {tasksForDate(selectedDate).length === 0 ? (
                    <div className="text-sm text-sage py-4">No tasks scheduled.</div>
                  ) : (
                    <div>
                      <TaskListHeader />
                      <AnimatePresence initial={false}>{applySort(tasksForDate(selectedDate)).map((t) => renderTaskRow(t))}</AnimatePresence>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {view === 'list' && filter === 'completed' && !selectedDate && (
            <>
              {filteredList.length === 0 && <div className="text-sm text-sage py-6 text-center">No completed tasks yet.</div>}
              {filteredList.length > 0 &&
                doneGroups(filteredList).map((g) => {
                  const isOpen = expandedDoneGroups.has(g.key)
                  return (
                    <div key={g.key} className="border-b border-ink/10">
                      <button
                        type="button"
                        onClick={() => toggleDoneGroup(g.key)}
                        className="w-full flex items-center justify-between py-2.5 text-sm font-medium text-ink/70 hover:text-ink"
                      >
                        <span>
                          {isOpen ? '▾' : '▸'} {g.label}
                        </span>
                        <span className="text-xs text-sage/70">{g.tasks.length}</span>
                      </button>
                      {isOpen && (
                        <div className="pb-2">
                          <TaskListHeader />
                          <AnimatePresence initial={false}>{g.tasks.map((t) => renderTaskRow(t))}</AnimatePresence>
                        </div>
                      )}
                    </div>
                  )
                })}
            </>
          )}

          {view === 'list' && (filter !== 'completed' || selectedDate) && (
            <>
              {filteredList.length === 0 && <div className="text-sm text-sage py-6 text-center">No tasks here.</div>}
              {filteredList.length > 0 &&
                (() => {
                  const { mine, unassigned } = splitBucket(filteredList)
                  const pendingCount = filteredList.filter((t) => !t.done).length
                  return (
                    <div>
                      <div className="flex items-center justify-end mb-1">
                        {pendingCount > 1 && (
                          <button className="text-xs text-sage hover:text-ink transition-colors" onClick={() => completeAll(filteredList)}>
                            Complete all ({pendingCount})
                          </button>
                        )}
                      </div>
                      <TaskListHeader />
                      <AnimatePresence initial={false}>{mine.map((t) => renderTaskRow(t))}</AnimatePresence>
                      {unassigned.length > 0 && (
                        <>
                          <div className="text-xs font-semibold tracking-wide text-sage/70 mt-3 mb-1">Unassigned</div>
                          <AnimatePresence initial={false}>{unassigned.map((t) => renderTaskRow(t))}</AnimatePresence>
                        </>
                      )}
                    </div>
                  )
                })()}
            </>
          )}

          {view === 'recurring' && (
            <div>
              <p className="text-sm text-sage mb-4">Repeats on a schedule you choose - daily, weekdays, or a specific day each week.</p>
              {showAddRecurring && (
                <div className="rounded-lg border border-ink/10 bg-white p-4 mb-3">
                  <input
                    className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
                    placeholder="e.g. Check emails"
                    value={recurringForm.title}
                    onChange={(e) => setRecurringForm((f) => ({ ...f, title: e.target.value }))}
                    autoFocus
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    <CustomSelect
                      value={recurringForm.frequency}
                      onChange={(v) => setRecurringForm((f) => ({ ...f, frequency: v }))}
                      options={[
                        { value: 'daily', label: 'Daily' },
                        { value: 'weekdays', label: 'Weekdays' },
                        ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({
                          value: `weekly:${(i + 1) % 7}`,
                          label: `Weekly – ${d}`,
                        })),
                      ]}
                    />
                    <CustomSelect value={recurringForm.priority} onChange={(v) => setRecurringForm((f) => ({ ...f, priority: v }))} options={PRIORITY.map((p) => ({ value: p, label: p }))} />
                    <CustomSelect
                      value={recurringForm.clientId}
                      onChange={(v) => setRecurringForm((f) => ({ ...f, clientId: v }))}
                      options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                    />
                    <CustomSelect
                      value={recurringForm.assignedTo}
                      onChange={(v) => setRecurringForm((f) => ({ ...f, assignedTo: v }))}
                      options={[
                        { value: '', label: 'Unassigned' },
                        ...members.map((m) => ({
                          value: m.user_id,
                          label: memberName(m),
                        })),
                      ]}
                    />
                  </div>
                  <SubtaskListEditor titles={recurringForm.subtasks} onChange={(subtasks) => setRecurringForm((f) => ({ ...f, subtasks }))} />
                  <div className="flex gap-2">
                    <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={() => setShowAddRecurring(false)}>
                      Cancel
                    </button>
                    <button className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={addRecurring}>
                      Save
                    </button>
                  </div>
                </div>
              )}
              {recurring.length === 0 && !showAddRecurring && <div className="text-sm text-sage py-6 text-center">No recurring tasks yet.</div>}
              {recurring.map((r) => (
                <div key={r.id} className="border-b border-ink/10 py-2">
                  {editingRecurringId === r.id ? (
                    <div className="rounded-lg border border-ink/10 bg-white p-4">
                      <input
                        className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
                        value={(editRecurringForm.title as string) || ''}
                        onChange={(e) =>
                          setEditRecurringForm((f) => ({
                            ...f,
                            title: e.target.value,
                          }))
                        }
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                        <CustomSelect
                          value={(editRecurringForm.frequency as string) || 'daily'}
                          onChange={(v) =>
                            setEditRecurringForm((f) => ({
                              ...f,
                              frequency: v,
                            }))
                          }
                          options={[
                            { value: 'daily', label: 'Daily' },
                            { value: 'weekdays', label: 'Weekdays' },
                            ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({
                              value: `weekly:${(i + 1) % 7}`,
                              label: `Weekly – ${d}`,
                            })),
                          ]}
                        />
                        <CustomSelect
                          value={(editRecurringForm.priority as string) || 'Medium'}
                          onChange={(v) => setEditRecurringForm((f) => ({ ...f, priority: v }))}
                          options={PRIORITY.map((p) => ({
                            value: p,
                            label: p,
                          }))}
                        />
                        <CustomSelect
                          value={(editRecurringForm.client_id as string) || ''}
                          onChange={(v) => setEditRecurringForm((f) => ({ ...f, client_id: v }))}
                          options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                        />
                        <CustomSelect
                          value={(editRecurringForm.assigned_to as string) || ''}
                          onChange={(v) => setEditRecurringForm((f) => ({ ...f, assigned_to: v }))}
                          options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.user_id, label: memberName(m) }))]}
                        />
                      </div>
                      <SubtaskListEditor
                        titles={(editRecurringForm.subtasks as string[]) || []}
                        onChange={(subtasks) => setEditRecurringForm((f) => ({ ...f, subtasks }))}
                      />
                      <div className="flex gap-2">
                        <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={() => setEditingRecurringId(null)}>
                          Cancel
                        </button>
                        <button className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={() => updateRecurring(r.id, editRecurringForm)}>
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${r.paused ? 'text-sage' : ''}`}>
                          {r.title}
                          {r.paused && <span className="ml-2 text-xs uppercase text-sage/70">Paused</span>}
                        </div>
                        <div className="text-xs text-sage mt-0.5">
                          {recurringFrequencyLabel(r.frequency)}
                          {r.client_id ? ` · ${clientName(r.client_id)}` : ''}
                          {r.assigned_to ? ` · ${memberEmail(r.assigned_to)}` : ''} · {r.priority}
                          {recurringSubtasks.filter((s) => s.template_id === r.id).length > 0
                            ? ` · ${recurringSubtasks.filter((s) => s.template_id === r.id).length} subtask${recurringSubtasks.filter((s) => s.template_id === r.id).length !== 1 ? 's' : ''}`
                            : ''}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => toggleRecurringPaused(r)}>
                        {r.paused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingRecurringId(r.id)
                          setEditRecurringForm({
                            title: r.title,
                            priority: r.priority,
                            frequency: r.frequency,
                            client_id: r.client_id || '',
                            assigned_to: r.assigned_to || '',
                            subtasks: recurringSubtasks.filter((s) => s.template_id === r.id).map((s) => s.title),
                          })
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => deleteRecurring(r.id)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {view === 'defaults' && (
            <div>
              <p className="text-sm text-sage mb-4">Applied automatically to every client, every day - including clients you add later.</p>
              {showAddDefault && (
                <div className="rounded-lg border border-ink/10 bg-white p-4 mb-3">
                  <input
                    className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
                    placeholder="e.g. Daily check-in"
                    value={defaultForm.title}
                    onChange={(e) => setDefaultForm((f) => ({ ...f, title: e.target.value }))}
                    autoFocus
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    <CustomSelect value={defaultForm.priority} onChange={(v) => setDefaultForm((f) => ({ ...f, priority: v }))} options={PRIORITY.map((p) => ({ value: p, label: p }))} />
                    <CustomSelect
                      value={defaultForm.assignedTo}
                      onChange={(v) => setDefaultForm((f) => ({ ...f, assignedTo: v }))}
                      options={[
                        { value: '', label: 'Unassigned' },
                        ...members.map((m) => ({
                          value: m.user_id,
                          label: memberName(m),
                        })),
                      ]}
                    />
                  </div>
                  <SubtaskListEditor titles={defaultForm.subtasks} onChange={(subtasks) => setDefaultForm((f) => ({ ...f, subtasks }))} />
                  <div className="flex gap-2">
                    <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={() => setShowAddDefault(false)}>
                      Cancel
                    </button>
                    <button className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={addDefault}>
                      Save
                    </button>
                  </div>
                </div>
              )}
              {defaults.length === 0 && !showAddDefault && <div className="text-sm text-sage py-6 text-center">No default tasks yet - every client gets these automatically, each day.</div>}
              {defaults.map((d) => (
                <div key={d.id} className="border-b border-ink/10 py-2">
                  {editingDefaultId === d.id ? (
                    <div className="rounded-lg border border-ink/10 bg-white p-4">
                      <input
                        className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
                        value={(editDefaultForm.title as string) || ''}
                        onChange={(e) =>
                          setEditDefaultForm((f) => ({
                            ...f,
                            title: e.target.value,
                          }))
                        }
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                        <CustomSelect
                          value={(editDefaultForm.priority as string) || 'Medium'}
                          onChange={(v) => setEditDefaultForm((f) => ({ ...f, priority: v }))}
                          options={PRIORITY.map((p) => ({
                            value: p,
                            label: p,
                          }))}
                        />
                        <CustomSelect
                          value={(editDefaultForm.assigned_to as string) || ''}
                          onChange={(v) =>
                            setEditDefaultForm((f) => ({
                              ...f,
                              assigned_to: v || null,
                            }))
                          }
                          options={[
                            { value: '', label: 'Unassigned' },
                            ...members.map((m) => ({
                              value: m.user_id,
                              label: memberName(m),
                            })),
                          ]}
                        />
                      </div>
                      <SubtaskListEditor titles={(editDefaultForm.subtasks as string[]) || []} onChange={(subtasks) => setEditDefaultForm((f) => ({ ...f, subtasks }))} />
                      <div className="flex gap-2">
                        <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={() => setEditingDefaultId(null)}>
                          Cancel
                        </button>
                        <button className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={() => updateDefault(d.id, editDefaultForm)}>
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${d.paused ? 'text-sage' : ''}`}>
                          {d.title}
                          {d.paused && <span className="ml-2 text-xs uppercase text-sage/70">Paused</span>}
                        </div>
                        <div className="text-xs text-sage mt-0.5">
                          Every client · daily
                          {d.assigned_to ? ` · ${memberEmail(d.assigned_to)}` : ''} · {d.priority}
                          {defaultSubtasks.filter((s) => s.template_id === d.id).length > 0
                            ? ` · ${defaultSubtasks.filter((s) => s.template_id === d.id).length} subtask${defaultSubtasks.filter((s) => s.template_id === d.id).length !== 1 ? 's' : ''}`
                            : ''}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => toggleDefaultPaused(d)}>
                        {d.paused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingDefaultId(d.id)
                          setEditDefaultForm({
                            title: d.title,
                            priority: d.priority,
                            assigned_to: d.assigned_to || '',
                            subtasks: defaultSubtasks.filter((s) => s.template_id === d.id).map((s) => s.title),
                          })
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => deleteDefault(d.id)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
