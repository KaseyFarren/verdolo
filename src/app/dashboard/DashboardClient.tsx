'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { createClient } from '@/lib/supabase/client'
import { ensureAutoAndRecurringTasks } from '@/lib/taskGen'
import { useTaskTimer } from '@/lib/useTaskTimer'
import {
  AVATAR_COLORS,
  centsToDollars,
  formatDate,
  getInitials,
  getOffsetDate,
  getStage,
  mrrCentsTotal,
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
  retainer_cents: number | null
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

export default function DashboardClient({
  orgId,
  userId,
  initialClients,
  initialTasks,
  initialRecurring,
  weekTimeEntries,
  hasApiKey,
  excludeWeekends,
}: {
  orgId: string
  userId: string
  initialClients: Client[]
  initialTasks: Task[]
  initialRecurring: Recurring[]
  weekTimeEntries: WeekTimeEntry[]
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

  const today = todayKey()
  const yesterday = getOffsetDate(-1)
  const tomorrow = getOffsetDate(1)
  const dashIsToday = dashDate === today
  const dashLabel = dashIsToday ? 'Today' : dashDate === yesterday ? 'Yesterday' : 'Tomorrow'

  const activeClients = clients.filter((c) => getStage(c) !== 'Churned')
  const mrr = centsToDollars(mrrCentsTotal(clients))
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
          <div className="text-2xl font-bold tracking-tight">Dashboard</div>
          <div className="text-sm text-neutral-500 mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          {mrr > 0 && (
            <div className="text-sm text-emerald-400 font-semibold mt-1">
              ${mrr.toLocaleString()}/mo MRR · {activeClients.length} active client{activeClients.length !== 1 ? 's' : ''}
            </div>
          )}
          {weekSeconds > 0 && (
            <div className="text-xs text-neutral-500 mt-1">
              {weekHours}h logged this week
              {topTimeClients.length > 0 && ` · ${topTimeClients.map((c) => c.name).join(', ')}`}
              {' · '}
              <Link href="/time" className="underline">
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
            className={`flex-1 rounded-md py-2 text-sm border ${dashDate === date ? 'border-white bg-white/10 text-white font-medium' : 'border-white/10 text-neutral-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {expiringContracts.length > 0 && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 mb-4 text-sm text-amber-400">
          <strong>Contracts expiring soon:</strong> {expiringContracts.map((c) => `${c.name} (${formatDate(c.contract_ends)})`).join(', ')}
        </div>
      )}

      {dashIsToday && (
        <div className="mb-6">
          {recap ? (
            <div className="rounded-lg border-l-2 border-white bg-white/5 p-4">
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs font-semibold uppercase text-neutral-500">Weekly Recap</div>
                <div className="flex gap-2">
                  <button className="text-xs text-neutral-400" onClick={generateRecap} disabled={loadingRecap}>
                    ↺
                  </button>
                  <button className="text-xs text-red-400" onClick={() => setRecap(null)}>
                    ✕
                  </button>
                </div>
              </div>
              <div className="text-sm leading-relaxed">{loadingRecap ? 'Generating…' : recap}</div>
            </div>
          ) : (
            <button
              className="w-full rounded-md border border-white/10 py-2 text-sm text-neutral-400"
              onClick={generateRecap}
              disabled={loadingRecap || !hasApiKey}
            >
              {loadingRecap ? '⏳ Generating recap…' : hasApiKey ? '✨ Generate weekly recap' : 'Add an Anthropic key in Settings to enable AI'}
            </button>
          )}
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{dashLabel}&apos;s tasks</div>
          <button
            className="text-xs text-neutral-400 hover:text-white"
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
              className="flex-1 rounded border border-white/10 bg-black/30 px-3 py-2 text-sm"
              placeholder="What needs doing?"
              value={quickAddTitle}
              onChange={(e) => setQuickAddTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addQuickTask()
                if (e.key === 'Escape') setShowQuickAdd(false)
              }}
            />
            <button className="rounded bg-white text-black px-3 py-2 text-sm font-medium" onClick={addQuickTask}>
              Add
            </button>
          </div>
        )}
        {dashPending.length === 0 && dashCompleted.length === 0 && !showQuickAdd && (
          <div className="text-sm text-neutral-500 py-3">
            No tasks for {dashLabel.toLowerCase()}.{' '}
            <button className="text-white underline" onClick={() => setShowQuickAdd(true)}>
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
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600 mt-3 mb-1">Unassigned</div>
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
            <div className="text-xs text-emerald-400 font-semibold uppercase mt-4 mb-2">Completed</div>
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

      <div>
        <div className="flex justify-between items-center mb-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Client messages</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-500">
              {msgTasksDone}/{activeClients.length} sent
            </span>
            {hasApiKey && (
              <button className="text-xs text-neutral-400 border border-white/10 rounded px-2 py-1" onClick={generateAll} disabled={loadingAll}>
                {loadingAll ? 'Writing…' : '✨ Generate all'}
              </button>
            )}
          </div>
        </div>
        {!hasApiKey && (
          <div className="text-sm text-neutral-500 py-2">
            Add an Anthropic API key in <Link href="/settings" className="underline text-white">Settings</Link> to generate AI check-ins.
          </div>
        )}
        {activeClients.map((c, i) => {
          const sent = isSentToday(c.id)
          const isGen = loadingOne === c.id
          return (
            <div key={c.id} className={`rounded-lg border p-3 mb-2 ${sent ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/5 border-white/10'}`}>
              <div className={`flex items-center gap-3 ${sent ? '' : 'mb-2.5'}`}>
                <Avatar name={c.name} index={i} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{c.name}</div>
                  <div className="text-xs text-neutral-500">
                    {c.platform || ''}
                    {c.business ? ` · ${c.business}` : ''}
                  </div>
                </div>
                {sent && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-emerald-400 font-semibold">✓ Sent</span>
                    <button className="text-xs text-neutral-400 border border-white/10 rounded px-2 py-0.5" onClick={() => undoSent(c)}>
                      Undo
                    </button>
                    {!c.awaiting_reply && (
                      <button className="text-xs text-amber-400 border border-white/10 rounded px-2 py-0.5" onClick={() => clearAwaitingReply(c)}>
                        ⏳ Awaiting reply
                      </button>
                    )}
                  </div>
                )}
              </div>
              {sent && c.awaiting_reply && (
                <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded px-2.5 py-1.5 mt-1">
                  <span className="text-xs text-amber-400">⏳ Awaiting reply</span>
                  <button className="text-xs text-emerald-400" onClick={() => clearAwaitingReply(c)}>
                    Got reply
                  </button>
                </div>
              )}
              {!sent && (
                <>
                  <input
                    className="w-full rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs mb-2"
                    placeholder="What to cover today… (optional)"
                    value={focusInputs[c.id] || ''}
                    onChange={(e) => setFocusInputs((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  />
                  {draftMessages[c.id] !== undefined && (
                    <textarea
                      className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-2 min-h-[70px]"
                      value={isGen ? 'Writing…' : draftMessages[c.id]}
                      onChange={(e) => setDraftMessages((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      className="rounded border border-white/10 px-3 py-1.5 text-xs"
                      onClick={() => generateOne(c.id)}
                      disabled={isGen || !hasApiKey}
                    >
                      {isGen ? 'Writing…' : draftMessages[c.id] !== undefined ? '↺' : '✨ Generate'}
                    </button>
                    {draftMessages[c.id] !== undefined && (
                      <button className="flex-1 rounded bg-white text-black px-3 py-1.5 text-xs font-medium" onClick={() => markSent(c)}>
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={allComplete ? '#2db87a' : '#fff'}
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
          style={{ transform: 'rotate(90deg)', transformOrigin: 'center', fill: allComplete ? '#2db87a' : '#fff', fontSize: size * 0.2, fontWeight: 700 }}
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
  const priorityColor = t.priority === 'High' ? 'text-red-400' : t.priority === 'Medium' ? 'text-amber-400' : 'text-emerald-400'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: t.done ? 0.45 : 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className={`flex gap-3 items-start py-2 border-b border-white/10 group ${isTimerRunning ? 'bg-emerald-500/5' : ''}`}
    >
      <button
        onClick={onToggle}
        className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 ${t.done ? 'bg-emerald-500 border-emerald-500' : 'border-neutral-500'}`}
      >
        {t.done && <span className="text-[10px] text-black">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${t.done ? 'line-through text-neutral-500' : ''}`}>
          {t.title}
          <span className={`ml-2 text-xs font-medium ${priorityColor}`}>{t.priority}</span>
          {isTimerRunning && <span className="ml-2 text-xs font-mono text-emerald-400">● {elapsed}</span>}
        </div>
        {clientName && <div className="text-xs text-neutral-500 mt-0.5">{clientName}</div>}
      </div>
      {!t.done && (
        <div className={`shrink-0 ${isTimerRunning ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {isTimerRunning ? (
            <button title="Stop timer" className="text-xs text-emerald-400 px-1" onClick={stopTimer}>
              ■
            </button>
          ) : (
            <button title="Start timer" className="text-xs text-neutral-400 px-1" onClick={startTimer}>
              ▶
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}
