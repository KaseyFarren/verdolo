'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ensureAutoAndRecurringTasks } from '@/lib/taskGen'
import { useTaskTimer } from '@/lib/useTaskTimer'
import CustomSelect, { type SelectGroup, type SelectOption } from '@/components/ui/CustomSelect'
import {
  PRIORITY,
  formatDate,
  getOffsetDate,
  memberName,
  recurringFrequencyLabel,
  sortTasks,
  todayKey,
} from '@/lib/agency'

type Client = { id: string; name: string }
type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null }
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
  recurring_id: string | null
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

const emptyTaskForm = { title: '', clientId: '', assignedTo: '', dueDate: todayKey(), priority: 'Medium', notes: '' }
const emptyRecurringForm = { title: '', clientId: '', assignedTo: '', priority: 'Medium', frequency: 'daily', notes: '' }

export default function TasksClient({
  orgId,
  userId,
  isAdmin,
  initialClients,
  initialTasks,
  initialRecurring,
  members,
  excludeWeekends,
}: {
  orgId: string
  userId: string
  isAdmin: boolean
  initialClients: Client[]
  initialTasks: Task[]
  initialRecurring: Recurring[]
  members: Member[]
  excludeWeekends: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const searchParams = useSearchParams()
  const [view, setView] = useState<'list' | 'calendar'>(searchParams.get('view') === 'calendar' ? 'calendar' : 'list')
  const [clients] = useState(initialClients)
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [recurring, setRecurring] = useState<Recurring[]>(initialRecurring)
  const [filter, setFilter] = useState('all')
  const [selectedDate, setSelectedDate] = useState('')
  const [calMonth, setCalMonth] = useState(todayKey().slice(0, 7))
  const [calNewTitle, setCalNewTitle] = useState('')
  const [showAddTask, setShowAddTask] = useState(false)
  const [taskMode, setTaskMode] = useState<'quick' | 'detailed'>('quick')
  const [taskForm, setTaskForm] = useState(emptyTaskForm)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, unknown>>({})
  const [showAddRecurring, setShowAddRecurring] = useState(false)
  const [recurringForm, setRecurringForm] = useState(emptyRecurringForm)
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null)
  const [editRecurringForm, setEditRecurringForm] = useState<Record<string, unknown>>({})
  const timer = useTaskTimer(supabase, orgId, userId)

  // router.refresh() (e.g. after the global quick-capture modal adds a task from any page)
  // re-runs the server component and gives us a new initialTasks array, but useState's
  // initializer only runs on mount — without this, the prop update never reaches local state.
  useEffect(() => {
    setTasks(initialTasks)
  }, [initialTasks])

  const today = todayKey()

  // Calendar view defaults to showing today's tasks rather than an empty selection — List
  // view's default (no date pinned, showing the Overdue/Today/Tomorrow buckets) is untouched.
  useEffect(() => {
    if (view === 'calendar' && !selectedDate) setSelectedDate(today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  useEffect(() => {
    ensureAutoAndRecurringTasks(supabase, orgId, initialClients, initialRecurring, excludeWeekends).then(async () => {
      const { data } = await supabase.from('tasks').select('*').eq('org_id', orgId).order('due_date')
      if (data) setTasks(data as Task[])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name || ''
  const memberEmail = (id: string | null) => memberName(members.find((m) => m.user_id === id))

  function selectDate(d: string) {
    setSelectedDate(d)
    if (d) setCalMonth(d.slice(0, 7))
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
        priority: taskForm.priority,
        notes: taskForm.notes,
        quick: taskMode === 'quick',
        done: false,
      })
      .select()
      .single()
    if (data) setTasks((prev) => [...prev, data as Task])
    setTaskForm(emptyTaskForm)
    setShowAddTask(false)
  }

  async function addCalendarTask() {
    if (!calNewTitle.trim() || !selectedDate) return
    const { data } = await supabase
      .from('tasks')
      .insert({ org_id: orgId, title: calNewTitle, due_date: selectedDate, priority: 'Medium', done: false, quick: true, assigned_to: userId })
      .select()
      .single()
    if (data) setTasks((prev) => [...prev, data as Task])
    setCalNewTitle('')
  }

  async function updateTask(id: string, fields: Record<string, unknown>) {
    const { data } = await supabase.from('tasks').update(fields).eq('id', id).select().single()
    if (data) setTasks((prev) => prev.map((t) => (t.id === id ? (data as Task) : t)))
    setEditingTaskId(null)
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
    for (const t of pending) await completeTask(t)
    if (pending.length) toast.success(`${pending.length} task${pending.length === 1 ? '' : 's'} completed`)
  }
  function deleteTask(id: string) {
    const removed = tasks.find((t) => t.id === id)
    if (!removed) return
    setTasks((prev) => prev.filter((t) => t.id !== id))
    const timeoutId = setTimeout(async () => {
      await supabase.from('tasks').delete().eq('id', id)
    }, 5000)
    toast('Task deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timeoutId)
          setTasks((prev) => [...prev, removed])
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
      await regenerateRecurringInstance(data as Recurring)
    }
    setRecurringForm(emptyRecurringForm)
    setShowAddRecurring(false)
  }
  // Regenerates this template's today/tomorrow instance right away (via the same idempotent
  // upsert used on mount) instead of leaving it missing until the next page load.
  async function regenerateRecurringInstance(r: Recurring) {
    await ensureAutoAndRecurringTasks(supabase, orgId, clients, [r], excludeWeekends)
    const { data: fresh } = await supabase.from('tasks').select('*').eq('org_id', orgId)
    if (fresh) setTasks(fresh as Task[])
  }
  async function updateRecurring(id: string, fields: Record<string, unknown>) {
    const { data } = await supabase.from('recurring_templates').update(fields).eq('id', id).select().single()
    if (data) setRecurring((prev) => prev.map((r) => (r.id === id ? (data as Recurring) : r)))
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
    await supabase.from('recurring_templates').delete().eq('id', id)
    await supabase.from('tasks').delete().eq('recurring_id', id)
    setRecurring((prev) => prev.filter((r) => r.id !== id))
    setTasks((prev) => prev.filter((t) => t.recurring_id !== id))
  }

  // skipped instances stay in the DB (so the recurring-instance upsert won't regenerate them)
  // but are hidden everywhere in the UI — they weren't actually done, just dismissed
  const visible = tasks.filter((t) => !t.skipped)
  const overdueCount = visible.filter((t) => t.due_date < today && !t.done).length

  // captures the assignee/client dimension of the current filter selection only — the
  // date/done-status dimension (today/overdue/completed/all) is handled separately by
  // visibleBuckets() and tasksForDate() below, since those two dimensions compose independently
  // (e.g. a pinned date + an assignee filter) in a way the old single-bucket-per-chip model never needed to
  function matchesFilter(t: Task): boolean {
    if (filter === 'assignee:mine') return t.assigned_to === userId
    if (filter === 'assignee:unassigned') return !t.assigned_to
    if (filter.startsWith('assignee:')) return t.assigned_to === filter.slice('assignee:'.length)
    if (filter !== 'all' && filter !== 'today' && filter !== 'overdue' && filter !== 'completed') return t.client_id === filter
    return true
  }

  function tasksForDate(date: string) {
    return sortTasks(visible.filter((t) => t.due_date === date && matchesFilter(t) && (filter !== 'completed' || t.done)))
  }

  function visibleBuckets(): { label: string; items: Task[] }[] {
    if (selectedDate) return [{ label: `Tasks for ${formatDate(selectedDate)}`, items: tasksForDate(selectedDate) }]
    if (filter === 'overdue') return [{ label: 'Overdue', items: sortTasks(visible.filter((t) => t.due_date < today && !t.done)) }]
    if (filter === 'today') return [{ label: 'Today', items: sortTasks(visible.filter((t) => t.due_date === today && !t.done)) }]
    if (filter === 'completed')
      return [{ label: 'Completed', items: [...visible.filter((t) => t.done)].sort((a, b) => b.due_date.localeCompare(a.due_date)) }]
    if (filter.startsWith('assignee:')) {
      const key = filter.slice('assignee:'.length)
      const label = key === 'mine' ? 'Mine' : key === 'unassigned' ? 'Unassigned' : memberEmail(key)
      const f = sortTasks(visible.filter((t) => matchesFilter(t))).sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1))
      return [{ label, items: f }]
    }
    if (filter !== 'all') {
      const f = sortTasks(visible.filter((t) => matchesFilter(t))).sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1))
      return [{ label: clientName(filter), items: f }]
    }
    const tomorrow = getOffsetDate(1)
    const yesterday = getOffsetDate(-1)
    return [
      { label: 'Overdue', items: sortTasks(visible.filter((t) => t.due_date < today && !t.done)) },
      { label: 'Yesterday', items: sortTasks(visible.filter((t) => t.due_date === yesterday && t.done)) },
      { label: 'Today', items: sortTasks(visible.filter((t) => t.due_date === today)) },
      { label: 'Tomorrow', items: sortTasks(visible.filter((t) => t.due_date === tomorrow)) },
      { label: 'Upcoming', items: sortTasks(visible.filter((t) => t.due_date > tomorrow)) },
    ].filter((b) => b.items.length > 0)
  }

  const buckets = visibleBuckets()
  // members only ever fetch their own + unassigned tasks (RLS-scoped); split those apart with
  // a header so "shared/unclaimed" work reads distinctly from "assigned to me". Admins/owners
  // see everyone's tasks flat (each row already shows its assignee) and use the chips instead.
  function splitBucket(items: Task[]) {
    if (isAdmin) return { mine: items, unassigned: [] as Task[] }
    return { mine: items.filter((t) => t.assigned_to !== null), unassigned: items.filter((t) => t.assigned_to === null) }
  }

  function renderTaskRow(t: Task) {
    return (
      <TaskRow
        key={t.id}
        t={t}
        currentUserId={userId}
        clientName={clientName}
        memberEmail={memberEmail}
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
        complete={() => completeTask(t)}
        uncomplete={() => uncompleteTask(t)}
        del={() => deleteTask(t.id)}
        snooze={() => snoozeTask(t)}
        skip={t.is_auto || t.recurring_id ? () => skipTask(t) : undefined}
        isTimerRunning={timer.running?.task_id === t.id}
        elapsed={timer.elapsedFor(t.id)}
        startTimer={() => timer.startForTask(t)}
        stopTimer={() => timer.stopRunning()}
      />
    )
  }

  const filterOptions: SelectOption[] = [
    { value: 'all', label: 'All' },
    { value: 'today', label: 'Today' },
    { value: 'overdue', label: overdueCount > 0 ? `Overdue (${overdueCount})` : 'Overdue' },
    { value: 'completed', label: 'Done' },
    ...(isAdmin ? [{ value: 'assignee:mine', label: 'Mine' }, { value: 'assignee:unassigned', label: 'Unassigned' }] : []),
  ]
  const filterGroups: SelectGroup[] = [
    ...(isAdmin && members.filter((m) => m.user_id !== userId).length > 0
      ? [
          {
            label: 'Team',
            options: members.filter((m) => m.user_id !== userId).map((m) => ({ value: `assignee:${m.user_id}`, label: memberName(m) })),
          },
        ]
      : []),
    ...(clients.length > 0 ? [{ label: 'Clients', options: clients.map((c) => ({ value: c.id, label: c.name })) }] : []),
  ]
  const filterSelect = (
    <CustomSelect value={filter} onChange={setFilter} options={filterOptions} groups={filterGroups} className="w-36" />
  )

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

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Tasks</h1>
          <div className="flex gap-1 bg-sand rounded-md p-1">
            {(['list', 'calendar'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 rounded text-xs capitalize ${view === v ? 'bg-white shadow-sm' : 'text-sage'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {view === 'list' && !showAddTask && (
          <button
            className="rounded-md bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium"
            onClick={() => {
              setShowAddTask(true)
              setTaskForm((f) => ({ ...emptyTaskForm, dueDate: selectedDate || todayKey(), title: f.title }))
            }}
          >
            + New task
          </button>
        )}
      </div>

      {view === 'list' && showAddTask && (
        <div className="rounded-lg border border-ink/10 bg-white p-4 mb-4">
          <div className="flex gap-1 bg-white rounded-md p-1 mb-3 w-fit">
            {(['quick', 'detailed'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTaskMode(m)}
                className={`px-3 py-1 rounded text-xs capitalize ${taskMode === m ? 'bg-ink/5' : 'text-sage'}`}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
            placeholder="What needs doing?"
            value={taskForm.title}
            onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="date"
              className="rounded border border-ink/10 bg-white px-2 py-2 text-sm"
              value={taskForm.dueDate}
              onChange={(e) => setTaskForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
            {taskMode === 'detailed' && (
              <CustomSelect
                value={taskForm.priority}
                onChange={(v) => setTaskForm((f) => ({ ...f, priority: v }))}
                options={PRIORITY.map((p) => ({ value: p, label: p }))}
              />
            )}
            {taskMode === 'detailed' && (
              <CustomSelect
                value={taskForm.clientId}
                onChange={(v) => setTaskForm((f) => ({ ...f, clientId: v }))}
                options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              />
            )}
            {taskMode === 'detailed' && (
              <CustomSelect
                value={taskForm.assignedTo}
                onChange={(v) => setTaskForm((f) => ({ ...f, assignedTo: v }))}
                options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.user_id, label: memberName(m) }))]}
              />
            )}
          </div>
          <textarea
            className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-3 min-h-[50px]"
            placeholder="Notes (optional)"
            value={taskForm.notes}
            onChange={(e) => setTaskForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <div className="flex gap-2">
            <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={() => setShowAddTask(false)}>
              Cancel
            </button>
            <button className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={addTask}>
              Add task
            </button>
          </div>
        </div>
      )}

      {view === 'list' ? (
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => selectDate(e.target.value)}
              className="rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
            />
            {selectedDate && (
              <button className="text-xs text-sage px-1" onClick={() => setSelectedDate('')}>
                ✕
              </button>
            )}
          </div>
          {filterSelect}
        </div>
      ) : (
        <div className="mb-4">{filterSelect}</div>
      )}

      {view === 'calendar' && (
        <>
          <div className="rounded-lg border border-ink/10 bg-white p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <button onClick={prevMonth} className="text-sage px-2">
                ‹
              </button>
              <div className="text-sm font-medium">{new Date(calY, jsMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
              <button onClick={nextMonth} className="text-sage px-2">
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={i} className="text-center text-[11px] text-sage py-1">
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
                    <div
                      key={d}
                      onClick={() => selectDate(k)}
                      className={`text-center py-1.5 rounded-md cursor-pointer ${isSel ? 'bg-accent text-white' : isToday ? 'bg-ink/5' : ''}`}
                    >
                      <div className={`text-sm ${isSel ? 'font-semibold' : isToday ? 'text-accent font-medium' : ''}`}>{d}</div>
                      {cnt > 0 && <div className={`h-1 w-1 rounded-full mx-auto mt-0.5 ${isSel ? 'bg-white/80' : 'bg-ink/40'}`} />}
                    </div>
                  )
                })}
            </div>
          </div>

          {selectedDate && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">{formatDate(selectedDate)}</div>
              </div>
              <div className="flex gap-2 mb-4">
                <input
                  className="flex-1 rounded border border-ink/10 bg-white px-3 py-2 text-sm"
                  placeholder="Add a task for this day…"
                  value={calNewTitle}
                  onChange={(e) => setCalNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCalendarTask()}
                />
                <button className="rounded bg-accent text-white px-3 py-2 text-sm font-medium shadow-md" onClick={addCalendarTask}>
                  Add
                </button>
              </div>

              {tasksForDate(selectedDate).length === 0 ? (
                <div className="text-sm text-sage py-4">No tasks scheduled.</div>
              ) : (
                <AnimatePresence initial={false}>{tasksForDate(selectedDate).map((t) => renderTaskRow(t))}</AnimatePresence>
              )}
            </>
          )}
        </>
      )}

      {view === 'list' && (
        <>
          {buckets.length === 0 && <div className="text-sm text-sage py-6 text-center">No tasks here.</div>}
          {buckets.map((b) => {
            const { mine, unassigned } = splitBucket(b.items)
            const pendingCount = b.items.filter((t) => !t.done).length
            return (
              <div key={b.label} className="mb-5">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-ink/10">
                  <div className="text-xs font-semibold uppercase tracking-wide text-sage">{b.label}</div>
                  {pendingCount > 1 && (
                    <button className="text-xs text-sage hover:text-ink transition-colors" onClick={() => completeAll(b.items)}>
                      Complete all ({pendingCount})
                    </button>
                  )}
                </div>
                <AnimatePresence initial={false}>{mine.map((t) => renderTaskRow(t))}</AnimatePresence>
                {unassigned.length > 0 && (
                  <>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-sage/70 mt-3 mb-1">Unassigned</div>
                    <AnimatePresence initial={false}>{unassigned.map((t) => renderTaskRow(t))}</AnimatePresence>
                  </>
                )}
              </div>
            )
          })}

          <div className="mt-8">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-sage">Recurring</div>
              <button className="text-xs text-sage" onClick={() => setShowAddRecurring((v) => !v)}>
                {showAddRecurring ? 'Cancel' : '+ Add'}
              </button>
            </div>
            {showAddRecurring && (
              <div className="rounded-lg border border-ink/10 bg-white p-4 mb-3">
                <input
                  className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
                  placeholder="e.g. Check emails"
                  value={recurringForm.title}
                  onChange={(e) => setRecurringForm((f) => ({ ...f, title: e.target.value }))}
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <CustomSelect
                    value={recurringForm.frequency}
                    onChange={(v) => setRecurringForm((f) => ({ ...f, frequency: v }))}
                    options={[
                      { value: 'daily', label: 'Daily' },
                      { value: 'weekdays', label: 'Weekdays' },
                      ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({ value: `weekly:${(i + 1) % 7}`, label: `Weekly – ${d}` })),
                    ]}
                  />
                  <CustomSelect
                    value={recurringForm.priority}
                    onChange={(v) => setRecurringForm((f) => ({ ...f, priority: v }))}
                    options={PRIORITY.map((p) => ({ value: p, label: p }))}
                  />
                  <CustomSelect
                    value={recurringForm.clientId}
                    onChange={(v) => setRecurringForm((f) => ({ ...f, clientId: v }))}
                    options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                  />
                  <CustomSelect
                    value={recurringForm.assignedTo}
                    onChange={(v) => setRecurringForm((f) => ({ ...f, assignedTo: v }))}
                    options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.user_id, label: memberName(m) }))]}
                  />
                </div>
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
            {recurring.length === 0 && !showAddRecurring && <div className="text-sm text-sage py-3">No recurring tasks.</div>}
            {recurring.map((r) => (
              <div key={r.id} className="border-b border-ink/10 py-2">
                {editingRecurringId === r.id ? (
                  <div className="rounded-lg border border-ink/10 bg-white p-4">
                    <input
                      className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
                      value={(editRecurringForm.title as string) || ''}
                      onChange={(e) => setEditRecurringForm((f) => ({ ...f, title: e.target.value }))}
                    />
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <CustomSelect
                        value={(editRecurringForm.frequency as string) || 'daily'}
                        onChange={(v) => setEditRecurringForm((f) => ({ ...f, frequency: v }))}
                        options={[
                          { value: 'daily', label: 'Daily' },
                          { value: 'weekdays', label: 'Weekdays' },
                          ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({ value: `weekly:${(i + 1) % 7}`, label: `Weekly – ${d}` })),
                        ]}
                      />
                      <CustomSelect
                        value={(editRecurringForm.priority as string) || 'Medium'}
                        onChange={(v) => setEditRecurringForm((f) => ({ ...f, priority: v }))}
                        options={PRIORITY.map((p) => ({ value: p, label: p }))}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={() => setEditingRecurringId(null)}>
                        Cancel
                      </button>
                      <button
                        className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium"
                        onClick={() => updateRecurring(r.id, editRecurringForm)}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className={`text-sm font-medium ${r.paused ? 'text-sage' : ''}`}>
                        {r.title}
                        {r.paused && <span className="ml-2 text-[10px] uppercase text-sage/70">Paused</span>}
                      </div>
                      <div className="text-xs text-sage mt-0.5">
                        {recurringFrequencyLabel(r.frequency)}
                        {r.client_id ? ` · ${clientName(r.client_id)}` : ''}
                        {r.assigned_to ? ` · ${memberEmail(r.assigned_to)}` : ''} · {r.priority}
                      </div>
                    </div>
                    <button className="text-xs text-sage" onClick={() => toggleRecurringPaused(r)}>
                      {r.paused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      className="text-xs text-sage"
                      onClick={() => {
                        setEditingRecurringId(r.id)
                        setEditRecurringForm({ title: r.title, priority: r.priority, frequency: r.frequency })
                      }}
                    >
                      Edit
                    </button>
                    <button className="text-xs text-red-600" onClick={() => deleteRecurring(r.id)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TaskRow({
  t,
  currentUserId,
  clientName,
  memberEmail,
  isEditing,
  editForm,
  setEditForm,
  clients,
  members,
  startEdit,
  cancelEdit,
  save,
  complete,
  uncomplete,
  del,
  snooze,
  skip,
  isTimerRunning,
  elapsed,
  startTimer,
  stopTimer,
}: {
  t: Task
  currentUserId: string
  clientName: (id: string | null) => string
  memberEmail: (id: string | null) => string
  isEditing: boolean
  editForm: Record<string, unknown>
  setEditForm: (f: (prev: Record<string, unknown>) => Record<string, unknown>) => void
  clients: Client[]
  members: Member[]
  startEdit: () => void
  cancelEdit: () => void
  save: () => void
  complete: () => void
  uncomplete: () => void
  del: () => void
  snooze: () => void
  skip?: () => void
  isTimerRunning: boolean
  elapsed: string | null
  startTimer: () => void
  stopTimer: () => void
}) {
  if (isEditing) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-4 mb-2">
        <input
          className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2 font-medium"
          value={(editForm.title as string) || ''}
          onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-2 mb-2">
          <CustomSelect
            value={(editForm.client_id as string) || ''}
            onChange={(v) => setEditForm((f) => ({ ...f, client_id: v }))}
            options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <CustomSelect
            value={(editForm.priority as string) || 'Medium'}
            onChange={(v) => setEditForm((f) => ({ ...f, priority: v }))}
            options={PRIORITY.map((p) => ({ value: p, label: p }))}
          />
          <CustomSelect
            value={(editForm.assigned_to as string) || ''}
            onChange={(v) => setEditForm((f) => ({ ...f, assigned_to: v }))}
            options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.user_id, label: memberName(m) }))]}
          />
          {!t.is_auto && (
            <input
              type="date"
              className="rounded border border-ink/10 bg-white px-2 py-2 text-sm"
              value={(editForm.due_date as string) || ''}
              onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
            />
          )}
        </div>
        <textarea
          className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-3"
          value={(editForm.notes as string) || ''}
          onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
        />
        <div className="flex gap-2">
          <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={cancelEdit}>
            Cancel
          </button>
          <button className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={save}>
            Save
          </button>
        </div>
      </div>
    )
  }

  const priorityColor = t.priority === 'High' ? 'text-red-600' : t.priority === 'Medium' ? 'text-amber-700' : 'text-green'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: t.done ? 0.45 : 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className={`flex gap-3 items-start py-2.5 border-b border-ink/10 group ${isTimerRunning ? 'bg-green/5' : ''}`}
    >
      <button
        onClick={() => (t.done ? uncomplete() : complete())}
        className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 ${t.done ? 'bg-green border-green' : 'border-ink/25'}`}
      >
        {t.done && <span className="text-[10px] text-white">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${t.done ? 'line-through text-sage' : ''}`}>
          {t.title}
          {!t.quick && <span className={`ml-2 text-xs font-medium ${priorityColor}`}>{t.priority}</span>}
          {t.is_auto && <span className="ml-1 text-[10px] text-sage">auto</span>}
          {t.recurring_id && <span className="ml-1 text-[10px] text-sage">↻</span>}
          {isTimerRunning && <span className="ml-2 text-xs font-mono text-green">● {elapsed}</span>}
        </div>
        <div className="text-xs text-sage mt-0.5 flex gap-2 flex-wrap">
          {t.client_id && <span>{clientName(t.client_id)}</span>}
          {t.assigned_to && t.assigned_to !== currentUserId && <span>→ {memberEmail(t.assigned_to)}</span>}
          <span>{formatDate(t.due_date)}</span>
          {t.done && t.completed_at && <span className="text-green">Done {new Date(t.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
        </div>
        {t.notes && !t.done && <div className="text-xs text-sage mt-1">{t.notes}</div>}
      </div>
      <div className={`flex gap-1 shrink-0 ${isTimerRunning ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {!t.done &&
          (isTimerRunning ? (
            <button title="Stop timer" className="text-xs text-green px-1" onClick={stopTimer}>
              ■
            </button>
          ) : (
            <button title="Start timer" className="text-xs text-sage px-1" onClick={startTimer}>
              ▶
            </button>
          ))}
        {!t.done && (
          <button title="Snooze — push to tomorrow" className="text-xs text-sage px-1" onClick={snooze}>
            ⏭
          </button>
        )}
        {!t.done && skip && (
          <button title="Skip this occurrence" className="text-xs text-sage px-1" onClick={skip}>
            ⤼
          </button>
        )}
        <button className="text-xs text-sage px-1" onClick={startEdit}>
          ✏
        </button>
        <button className="text-xs text-red-600 px-1" onClick={del}>
          ✕
        </button>
      </div>
    </motion.div>
  )
}
