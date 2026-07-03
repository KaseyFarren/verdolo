'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { createClient } from '@/lib/supabase/client'
import { ensureAutoAndRecurringTasks } from '@/lib/taskGen'
import { useTaskTimer } from '@/lib/useTaskTimer'
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
}
type Task = {
  id: string
  client_id: string | null
  assigned_to: string | null
  title: string
  due_date: string
  priority: string
  done: boolean
  completed_at: string | null
  is_auto: boolean
  auto_type: string | null
  skipped: boolean
}
type Recurring = { id: string; title: string; client_id: string | null; priority: string; frequency: string; notes: string | null }
type WeekTimeEntry = { client_id: string | null; duration_seconds: number | null }
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
  weekTimeEntries,
  todayTimeEntries,
  members,
  initialNote,
  hasApiKey,
  excludeWeekends,
}: {
  orgId: string
  userId: string
  isAdmin: boolean
  initialClients: Client[]
  initialTasks: Task[]
  initialRecurring: Recurring[]
  weekTimeEntries: WeekTimeEntry[]
  todayTimeEntries: TodayTimeEntry[]
  members: Member[]
  initialNote: string
  hasApiKey: boolean
  excludeWeekends: boolean
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
  const [recap, setRecap] = useState<string | null>(null)
  const [loadingRecap, setLoadingRecap] = useState(false)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickAddTitle, setQuickAddTitle] = useState('')

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
  const weekSeconds = weekTimeEntries.reduce((s, e) => s + (e.duration_seconds || 0), 0)
  const weekHours = (weekSeconds / 3600).toFixed(1)
  const topTimeClients = clients
    .map((c) => ({
      name: c.name,
      seconds: weekTimeEntries.filter((e) => e.client_id === c.id).reduce((s, e) => s + (e.duration_seconds || 0), 0),
    }))
    .filter((r) => r.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 3)
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
    return tasks.some((t) => t.client_id === clientId && t.is_auto && t.auto_type === 'checkin' && t.due_date === today && t.done)
  }

  async function addQuickTask() {
    const title = quickAddTitle.trim()
    if (!title) return
    setQuickAddTitle('')
    const { data } = await supabase
      .from('tasks')
      .insert({ org_id: orgId, title, due_date: dashDate, priority: 'Medium', quick: true, done: false, assigned_to: userId })
      .select()
      .single()
    if (data) setTasks((prev) => [...prev, data as Task])
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

    await supabase.from('ai_message_log').insert({ org_id: orgId, client_id: client.id, message })
    await supabase.from('clients').update({ last_contacted: today, awaiting_reply: true }).eq('id', client.id)

    const checkin = tasks.find((t) => t.client_id === client.id && t.is_auto && t.auto_type === 'checkin' && (t.due_date === today || (t.due_date < today && !t.done)))
    if (checkin) {
      const { data } = await supabase.from('tasks').update({ done: true, completed_at: new Date().toISOString() }).eq('id', checkin.id).select().single()
      if (data) setTasks((prev) => prev.map((x) => (x.id === checkin.id ? (data as Task) : x)))
    }
  }

  async function undoSent(client: Client) {
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
          {weekSeconds > 0 && (
            <div className="text-xs text-sage mt-1">
              {weekHours}h logged this week
              {topTimeClients.length > 0 && ` · ${topTimeClients.map((c) => c.name).join(', ')}`}
              {' · '}
              <Link href="/time" className="underline text-accent">
                Time
              </Link>
            </div>
          )}
        </div>
        <ProgressRing done={ringDone} total={ringTotal} />
      </div>

      <div className="flex gap-2 mb-5">
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
        <div className="mb-6">
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
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6 items-start">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-sage">{dashLabel}&apos;s tasks</div>
            <button
              className="text-xs text-sage hover:text-ink"
              onClick={() => {
                setShowQuickAdd((v) => !v)
                setQuickAddTitle('')
              }}
            >
              {showQuickAdd ? 'Cancel' : '+ Add'}
            </button>
          </div>
          {showQuickAdd && (
            <div className="flex gap-2 mb-2">
              <input
                autoFocus
                className="flex-1 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
                placeholder="What needs doing?"
                value={quickAddTitle}
                onChange={(e) => setQuickAddTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addQuickTask()
                  if (e.key === 'Escape') setShowQuickAdd(false)
                }}
              />
              <button className="rounded-lg bg-accent text-white px-3 py-2 text-sm font-medium shadow-md" onClick={addQuickTask}>
                Add
              </button>
            </div>
          )}
          {dashPending.length === 0 && dashCompleted.length === 0 && !showQuickAdd && (
            <div className="text-sm text-sage py-3">
              No tasks for {dashLabel.toLowerCase()}.{' '}
              <button className="text-accent underline" onClick={() => setShowQuickAdd(true)}>
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

      <div className="mt-8">
        <div className="flex justify-between items-center mb-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-sage">Client messages</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-sage">
              {msgTasksDone}/{activeClients.length} sent
            </span>
            {hasApiKey && (
              <button className="text-xs text-sage hover:text-ink border border-ink/15 rounded-lg px-2 py-1" onClick={generateAll} disabled={loadingAll}>
                {loadingAll ? 'Writing…' : '✨ Generate all'}
              </button>
            )}
          </div>
        </div>
        {!hasApiKey && (
          <div className="text-sm text-sage py-2">
            Add an Anthropic API key in <Link href="/settings" className="underline text-accent">Settings</Link> to generate AI check-ins.
          </div>
        )}
        {activeClients.map((c, i) => {
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green font-semibold">✓ Sent</span>
                    <button className="text-xs text-sage border border-ink/15 rounded-lg px-2 py-0.5" onClick={() => undoSent(c)}>
                      Undo
                    </button>
                    {!c.awaiting_reply && (
                      <button className="text-xs text-amber-700 border border-ink/15 rounded-lg px-2 py-0.5" onClick={() => clearAwaitingReply(c)}>
                        ⏳ Awaiting reply
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
                  />
                  {draftMessages[c.id] !== undefined && (
                    <textarea
                      className="w-full rounded-lg border border-ink/10 bg-cream px-3 py-2 text-sm mb-2 min-h-[70px] text-ink"
                      value={isGen ? 'Writing…' : draftMessages[c.id]}
                      onChange={(e) => setDraftMessages((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs text-sage hover:text-ink"
                      onClick={() => generateOne(c.id)}
                      disabled={isGen || !hasApiKey}
                    >
                      {isGen ? 'Writing…' : draftMessages[c.id] !== undefined ? '↺' : '✨ Generate'}
                    </button>
                    {draftMessages[c.id] !== undefined && (
                      <button className="flex-1 rounded-lg bg-accent text-white px-3 py-1.5 text-xs font-medium shadow-md" onClick={() => markSent(c)}>
                        {copiedId === c.id ? '✓ Copied' : 'Copy & mark sent'}
                      </button>
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
}: {
  t: Task
  clientName?: string
  onToggle: () => void
  isTimerRunning: boolean
  elapsed: string | null
  startTimer: () => void
  stopTimer: () => void
}) {
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
        className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 ${t.done ? 'bg-accent border-accent' : 'border-ink/25'}`}
      >
        {t.done && <span className="text-[10px] text-white">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${t.done ? 'line-through text-sage' : 'text-ink'}`}>
          {t.title}
          <span className={`ml-2 text-xs font-medium ${priorityColor}`}>{t.priority}</span>
          {isTimerRunning && <span className="ml-2 text-xs font-mono text-green">● {elapsed}</span>}
        </div>
        {clientName && <div className="text-xs text-sage mt-0.5">{clientName}</div>}
      </div>
      {!t.done && (
        <div className={`shrink-0 ${isTimerRunning ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {isTimerRunning ? (
            <button title="Stop timer" className="text-xs text-green px-1" onClick={stopTimer}>
              ■
            </button>
          ) : (
            <button title="Start timer" className="text-xs text-sage px-1" onClick={startTimer}>
              ▶
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}
