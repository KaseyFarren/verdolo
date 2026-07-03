'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { createClient } from '@/lib/supabase/client'
import { ensureAutoAndRecurringTasks } from '@/lib/taskGen'
import { useTaskTimer } from '@/lib/useTaskTimer'
import Button from '@/components/ui/Button'
import AddTaskForm, { type TaskFormState } from '@/components/tasks/AddTaskForm'
import TaskEditForm from '@/components/tasks/TaskEditForm'
import {
  AVATAR_COLORS,
  formatDate,
  getInitials,
  getOffsetDate,
  getStage,
  memberName,
  sortTasks,
  todayKey,
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
}
type Recurring = { id: string; title: string; client_id: string | null; priority: string; frequency: string; notes: string | null }
type TodayTimeEntry = { user_id: string; client_id: string | null; duration_seconds: number | null }
type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null }

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
  initialClients,
  initialTasks,
  initialRecurring,
  todayTimeEntries,
  members,
  initialNote,
  hasApiKey,
  excludeWeekends,
  initialRecap,
  pastReports,
  initialSentToday,
}: {
  orgId: string
  userId: string
  isAdmin: boolean
  initialClients: Client[]
  initialTasks: Task[]
  initialRecurring: Recurring[]
  todayTimeEntries: TodayTimeEntry[]
  members: Member[]
  initialNote: string
  hasApiKey: boolean
  excludeWeekends: boolean
  initialRecap: string | null
  pastReports: { week_start: string; content: string }[]
  initialSentToday: string[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [clients] = useState<Client[]>(initialClients)
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const timer = useTaskTimer(supabase, orgId, userId)

  // router.refresh() (e.g. after the global quick-capture modal adds a task from any page)
  // re-runs the server component and gives us a new initialTasks array, but useState's
  // initializer only runs on mount — without this, the prop update never reaches local state.
  useEffect(() => {
    setTasks(initialTasks)
  }, [initialTasks])

  useEffect(() => {
    ensureAutoAndRecurringTasks(supabase, orgId, initialClients, initialRecurring, excludeWeekends).then(async () => {
      const { data } = await supabase.from('tasks').select('*').eq('org_id', orgId)
      if (data) setTasks(data as Task[])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [dashDate, setDashDate] = useState(todayKey())
  const [draftMessages, setDraftMessages] = useState<Record<string, string>>({})
  const [focusInputs, setFocusInputs] = useState<Record<string, string>>({})
  const [loadingAll, setLoadingAll] = useState(false)
  const [loadingOne, setLoadingOne] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [recap, setRecap] = useState<string | null>(initialRecap)
  const [loadingRecap, setLoadingRecap] = useState(false)
  const [showPastReports, setShowPastReports] = useState(false)
  const [showMessages, setShowMessages] = useState(true)
  const [sentClientIds, setSentClientIds] = useState<Set<string>>(new Set(initialSentToday))
  const [showAddTask, setShowAddTask] = useState(false)
  const [taskMode, setTaskMode] = useState<'quick' | 'detailed'>('quick')
  const [taskForm, setTaskForm] = useState<TaskFormState>({ title: '', clientId: '', assignedTo: '', dueDate: todayKey(), priority: 'Medium', notes: '' })
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, unknown>>({})

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
  const thirtyDaysOut = getOffsetDate(30)
  const expiringContracts = clients.filter((c) => c.contract_ends && c.contract_ends <= thirtyDaysOut && c.contract_ends >= today && getStage(c) !== 'Churned')

  // Team-today panel: one shared query (page.tsx), RLS does the role-scoping for free —
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

  // Dashboard is everyone's personal "my day" view, not the full org workload (that's the
  // Tasks page) — scope to tasks assigned to me + unassigned/shared ones, even for admins/owners
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
        priority: taskForm.priority,
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
    const { data } = await supabase.from('tasks').update(fields).eq('id', id).select().single()
    if (data) setTasks((prev) => prev.map((t) => (t.id === id ? (data as Task) : t)))
    setEditingTaskId(null)
  }

  async function toggleTask(t: Task) {
    const nowDone = !t.done
    if (nowDone) await timer.stopIfRunningFor(t.id)
    const { data } = await supabase
      .from('tasks')
      .update({ done: nowDone, completed_at: nowDone ? new Date().toISOString() : null })
      .eq('id', t.id)
      .select()
      .single()
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
    } finally {
      setLoadingOne(null)
    }
  }

  async function markSent(client: Client) {
    const message = draftMessages[client.id]
    if (!message) return
    try {
      await navigator.clipboard.writeText(message)
    } catch {}
    setCopiedId(client.id)
    setTimeout(() => setCopiedId(null), 2000)

    const { error } = await supabase.from('ai_message_log').insert({ org_id: orgId, client_id: client.id, message })
    if (error) return
    setSentClientIds((prev) => new Set(prev).add(client.id))
    await supabase.from('clients').update({ last_contacted: today, awaiting_reply: true }).eq('id', client.id)

    // Best-effort: also close out today's auto-checkin task if one exists, so it drops off
    // the Tasks list — the "Sent" UI above no longer depends on this succeeding.
    const checkin = tasks.find((t) => t.client_id === client.id && t.is_auto && t.auto_type === 'checkin' && (t.due_date === today || (t.due_date < today && !t.done)))
    if (checkin) {
      const { data } = await supabase.from('tasks').update({ done: true, completed_at: new Date().toISOString() }).eq('id', checkin.id).select().single()
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

  async function clearAwaitingReply(client: Client) {
    await supabase.from('clients').update({ awaiting_reply: false }).eq('id', client.id)
  }

  async function generateRecap() {
    setLoadingRecap(true)
    try {
      const res = await fetch('/api/ai/weekly-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const body = await res.json()
      setRecap(res.ok ? body.recap : 'Failed to generate. Check your API key in Settings.')
    } finally {
      setLoadingRecap(false)
    }
  }

  const msgTasksDone = activeClients.filter((c) => isSentToday(c.id)).length

  return (
    <div>
      <div className="flex justify-between items-start mb-5">
        <div>
          <div className="font-heading text-2xl font-bold text-ink">Dashboard</div>
          <div className="text-sm text-sage mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          {activeClients.length > 0 && (
            <div className="text-sm text-sage mt-1">
              {activeClients.length} active client{activeClients.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
        <ProgressRing done={ringDone} total={ringTotal} />
      </div>

      <div className="flex gap-2 mb-5 pt-5 border-t border-ink/10">
        {[
          ['Yesterday', yesterday],
          ['Today', today],
          ['Tomorrow', tomorrow],
        ].map(([label, date]) => (
          <button
            key={date}
            onClick={() => setDashDate(date)}
            className={`flex-1 rounded-xl py-2 text-sm border transition-colors ${
              dashDate === date ? 'border-accent bg-accent text-white font-medium shadow-md' : 'border-ink/10 bg-white text-sage hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {expiringContracts.length > 0 && (
        <div className="rounded-xl bg-amber-100/70 border border-amber-300 px-3 py-2 mb-4 text-sm text-amber-800">
          <strong>Contracts expiring soon:</strong> {expiringContracts.map((c) => `${c.name} (${formatDate(c.contract_ends)})`).join(', ')}
        </div>
      )}

      {dashIsToday && (
        <div className="mb-6 pt-6 border-t border-ink/10">
          {recap ? (
            <div className="rounded-2xl bg-white shadow-md border-l-4 border-accent p-4">
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs font-semibold uppercase text-sage">Weekly Recap</div>
                <div className="flex gap-2">
                  <button className="text-xs text-sage hover:text-ink" onClick={generateRecap} disabled={loadingRecap}>
                    ↺
                  </button>
                  <button className="text-xs text-red-600" onClick={() => setRecap(null)}>
                    ✕
                  </button>
                </div>
              </div>
              <div className="text-sm leading-relaxed text-ink">{loadingRecap ? 'Generating…' : recap}</div>
            </div>
          ) : (
            <button
              className="w-full rounded-xl border border-ink/10 bg-white py-2 text-sm text-sage shadow-md disabled:opacity-50"
              onClick={generateRecap}
              disabled={loadingRecap || !hasApiKey}
            >
              {loadingRecap ? '⏳ Generating recap…' : hasApiKey ? '✨ Generate weekly recap' : 'Add an Anthropic key in Settings to enable AI'}
            </button>
          )}
          {pastReports.length > 0 && (
            <div className="mt-2">
              <button className="text-xs text-sage hover:text-ink" onClick={() => setShowPastReports((v) => !v)}>
                {showPastReports ? '▾' : '▸'} Past reports ({pastReports.length})
              </button>
              {showPastReports && (
                <div className="mt-2 space-y-2">
                  {pastReports.map((r) => (
                    <div key={r.week_start} className="rounded-xl bg-white shadow-md p-3">
                      <div className="text-xs font-semibold text-sage mb-1">Week of {formatDate(r.week_start)}</div>
                      <div className="text-sm leading-relaxed text-ink">{r.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6 items-start pt-6 border-t border-ink/10">
        <div className="rounded-2xl bg-white shadow-md p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-sage">{dashLabel}&apos;s tasks</div>
            <button
              className="text-xs text-sage hover:text-ink"
              onClick={() => {
                setShowAddTask((v) => !v)
                if (!showAddTask) setTaskForm((f) => ({ ...f, title: '', notes: '', dueDate: dashDate }))
              }}
            >
              {showAddTask ? 'Cancel' : '+ Add'}
            </button>
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
          {dashPending.length === 0 && dashCompleted.length === 0 && !showAddTask && (
            <div className="text-sm text-sage py-3">
              No tasks for {dashLabel.toLowerCase()}.{' '}
              <button
                className="text-accent underline"
                onClick={() => {
                  setShowAddTask(true)
                  setTaskForm((f) => ({ ...f, title: '', notes: '', dueDate: dashDate }))
                }}
              >
                Add one →
              </button>
            </div>
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
              />
            ))}
          </AnimatePresence>
          {dashPendingUnassigned.length > 0 && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-sage/70 mt-3 mb-1">Unassigned</div>
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
                  />
                ))}
              </AnimatePresence>
            </>
          )}
          {dashCompleted.length > 0 && (
            <>
              <div className="text-xs text-green font-semibold uppercase mt-4 mb-2">Completed</div>
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
                />
              ))}
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-white shadow-md p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-3">{isAdmin ? 'Team today' : 'My time today'}</div>
            {teamToday.length === 0 ? (
              <div className="text-sm text-sage">No time logged yet today.</div>
            ) : (
              teamToday.map((r) => (
                <div key={r.key} className="flex justify-between items-center py-1.5 text-sm border-b border-ink/5 last:border-0">
                  <span className="text-ink truncate pr-2">{r.label}</span>
                  <span className="font-medium text-ink shrink-0">{formatHoursMins(r.seconds)}</span>
                </div>
              ))
            )}
          </div>

          <div className="rounded-2xl bg-white shadow-md p-4 flex flex-col flex-1 min-h-[220px]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-sage">Quick notes</div>
              <span className="text-[10px] text-sage">{noteSaved ? 'Saved' : 'Saving…'}</span>
            </div>
            <textarea
              className="flex-1 w-full min-h-[160px] resize-none bg-transparent text-sm text-ink outline-none placeholder:text-sage/60"
              placeholder="Jot something down…"
              value={note}
              onChange={(e) => updateNote(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-ink/10">
        <div className="flex justify-between items-center mb-2">
          <button className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sage hover:text-ink" onClick={() => setShowMessages((v) => !v)}>
            <span className="text-[10px]">{showMessages ? '▾' : '▸'}</span> Client messages
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-sage">
              {msgTasksDone}/{activeClients.length} sent
            </span>
            {showMessages && hasApiKey && (
              <Button variant="secondary" size="sm" className="text-sage hover:text-ink" onClick={generateAll} disabled={loadingAll}>
                {loadingAll ? 'Writing…' : '✨ Generate all'}
              </Button>
            )}
          </div>
        </div>
        {showMessages && !hasApiKey && (
          <div className="text-sm text-sage py-2">
            Add an Anthropic API key in <Link href="/settings" className="underline text-accent">Settings</Link> to generate AI check-ins.
          </div>
        )}
        {showMessages && activeClients.map((c, i) => {
          const sent = isSentToday(c.id)
          const isGen = loadingOne === c.id
          return (
            <div key={c.id} className={`rounded-2xl p-3 mb-2 ${sent ? 'bg-green/5 border border-green/20' : 'bg-white shadow-md'}`}>
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
                    <span className="text-green font-semibold">✓ Sent</span>
                    <button className="text-sage hover:text-ink hover:underline" onClick={() => undoSent(c)}>
                      Undo
                    </button>
                    {!c.awaiting_reply && (
                      <button title="Mark awaiting reply" className="text-amber-700 hover:text-amber-800" onClick={() => clearAwaitingReply(c)}>
                        ⏳
                      </button>
                    )}
                  </div>
                )}
              </div>
              {sent && c.awaiting_reply && (
                <div className="flex items-center justify-between bg-amber-100/70 border border-amber-300 rounded-lg px-2.5 py-1.5 mt-1">
                  <span className="text-xs text-amber-800">⏳ Awaiting reply</span>
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
                    <Button variant="secondary" size="md" className="text-xs text-sage hover:text-ink" onClick={() => generateOne(c.id)} disabled={isGen || !hasApiKey}>
                      {isGen ? 'Writing…' : draftMessages[c.id] !== undefined ? '↺' : '✨ Generate'}
                    </Button>
                    {draftMessages[c.id] !== undefined && (
                      <Button variant="primary" size="md" className="flex-1 text-xs" onClick={() => markSent(c)}>
                        {copiedId === c.id ? '✓ Copied' : 'Copy & mark sent'}
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(26,26,23,0.08)" strokeWidth={6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={allComplete ? '#1f3320' : '#dd6b2c'}
          strokeWidth={6}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          style={{ transform: 'rotate(90deg)', transformOrigin: 'center', fill: allComplete ? '#1f3320' : '#1a1a17', fontSize: size * 0.2, fontWeight: 700 }}
        >
          {allComplete ? '✓' : `${done}/${total}`}
        </text>
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
  isEditing,
  editForm,
  setEditForm,
  clients,
  members,
  startEdit,
  cancelEdit,
  save,
}: {
  t: Task
  clientName?: string
  onToggle: () => void
  isTimerRunning: boolean
  elapsed: string | null
  startTimer: () => void
  stopTimer: () => void
  isEditing: boolean
  editForm: Record<string, unknown>
  setEditForm: (f: (prev: Record<string, unknown>) => Record<string, unknown>) => void
  clients: Client[]
  members: Member[]
  startEdit: () => void
  cancelEdit: () => void
  save: () => void
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

  const priorityColor = t.priority === 'High' ? 'text-red-600' : t.priority === 'Medium' ? 'text-accent' : 'text-green'
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
        title={isTimerRunning ? 'Mark done — stops the running timer' : undefined}
        className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
          t.done ? 'bg-accent border-accent' : isTimerRunning ? 'border-green ring-2 ring-green/30' : 'border-ink/25'
        }`}
      >
        {t.done && <span className="text-[10px] text-white">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${t.done ? 'line-through text-sage' : 'text-ink'}`}>
          {t.title}
          <span className={`ml-2 text-xs font-medium ${priorityColor}`}>{t.priority}</span>
          {isTimerRunning && (
            <span className="ml-2 text-xs font-mono text-green inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" /> {elapsed}
            </span>
          )}
        </div>
        {clientName && <div className="text-xs text-sage mt-0.5">{clientName}</div>}
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
        <button title="Edit" className="text-xs text-sage px-1" onClick={startEdit}>
          ✏
        </button>
      </div>
    </motion.div>
  )
}
