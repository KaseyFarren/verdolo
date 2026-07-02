'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { memberName, todayKey } from '@/lib/agency'

type Client = { id: string; name: string }
type Task = { id: string; title: string; client_id: string | null }
type Entry = {
  id: string
  client_id: string | null
  task_id: string | null
  user_id: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  note: string | null
  billable: boolean
}
type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null }

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function formatHours(seconds: number) {
  return (seconds / 3600).toFixed(1)
}

export default function TimeClient({
  orgId,
  userId,
  isAdmin,
  clients,
  tasks,
  initialEntries,
  members,
}: {
  orgId: string
  userId: string
  isAdmin: boolean
  clients: Client[]
  tasks: Task[]
  initialEntries: Entry[]
  members: Member[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [entries, setEntries] = useState<Entry[]>(initialEntries)
  const [now, setNow] = useState<number | null>(null)

  const [timerClientId, setTimerClientId] = useState('')
  const [timerTaskId, setTimerTaskId] = useState('')
  const [timerNote, setTimerNote] = useState('')
  const [starting, setStarting] = useState(false)

  const [showManual, setShowManual] = useState(false)
  const [manualClientId, setManualClientId] = useState('')
  const [manualTaskId, setManualTaskId] = useState('')
  const [manualDate, setManualDate] = useState(todayKey())
  const [manualHours, setManualHours] = useState('')
  const [manualNote, setManualNote] = useState('')
  const [manualBillable, setManualBillable] = useState(true)

  const running = entries.find((e) => e.user_id === userId && e.ended_at === null) || null

  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [running?.id])

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name || '—'
  const taskTitle = (id: string | null) => tasks.find((t) => t.id === id)?.title || null
  const memberEmail = (id: string) => memberName(members.find((m) => m.user_id === id))

  async function startTimer() {
    if (!timerClientId) return
    setStarting(true)
    const { data } = await supabase
      .from('time_entries')
      .insert({
        org_id: orgId,
        client_id: timerClientId,
        task_id: timerTaskId || null,
        user_id: userId,
        started_at: new Date().toISOString(),
        note: timerNote || null,
        billable: true,
      })
      .select()
      .single()
    if (data) setEntries((prev) => [data as Entry, ...prev])
    setStarting(false)
  }

  async function stopTimer() {
    if (!running) return
    const endedAt = new Date()
    const startedAt = new Date(running.started_at)
    const durationSeconds = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
    const { data } = await supabase
      .from('time_entries')
      .update({ ended_at: endedAt.toISOString(), duration_seconds: durationSeconds })
      .eq('id', running.id)
      .select()
      .single()
    if (data) setEntries((prev) => prev.map((e) => (e.id === running.id ? (data as Entry) : e)))
    setTimerClientId('')
    setTimerTaskId('')
    setTimerNote('')
  }

  async function addManualEntry() {
    const hours = parseFloat(manualHours)
    if (!manualClientId || !hours || hours <= 0) return
    const startedAt = `${manualDate}T12:00:00`
    const durationSeconds = Math.round(hours * 3600)
    const endedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString()
    const { data } = await supabase
      .from('time_entries')
      .insert({
        org_id: orgId,
        client_id: manualClientId,
        task_id: manualTaskId || null,
        user_id: userId,
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: durationSeconds,
        note: manualNote || null,
        billable: manualBillable,
      })
      .select()
      .single()
    if (data) setEntries((prev) => [data as Entry, ...prev])
    setManualClientId('')
    setManualTaskId('')
    setManualHours('')
    setManualNote('')
    setShowManual(false)
  }

  async function deleteEntry(id: string) {
    await supabase.from('time_entries').delete().eq('id', id)
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const completed = entries.filter((e) => e.ended_at && e.duration_seconds)
  const totalByClient = clients
    .map((c) => ({ client: c, seconds: completed.filter((e) => e.client_id === c.id).reduce((s, e) => s + (e.duration_seconds || 0), 0) }))
    .filter((r) => r.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)

  const totalByMember = isAdmin
    ? members
        .map((m) => ({ member: m, seconds: completed.filter((e) => e.user_id === m.user_id).reduce((s, e) => s + (e.duration_seconds || 0), 0) }))
        .filter((r) => r.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
    : []

  const timerTasks = tasks.filter((t) => t.client_id === timerClientId)
  const manualTasks = tasks.filter((t) => t.client_id === manualClientId)

  const grouped: { date: string; items: Entry[] }[] = []
  for (const e of completed) {
    const date = e.started_at.slice(0, 10)
    let bucket = grouped.find((g) => g.date === date)
    if (!bucket) {
      bucket = { date, items: [] }
      grouped.push(bucket)
    }
    bucket.items.push(e)
  }
  grouped.sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div>
      <h1 className="text-xl font-semibold mb-5">Time</h1>

      <div className="rounded-lg border border-white/10 bg-white/5 p-4 mb-6">
        {running ? (
          <div>
            <div className="text-2xl font-mono font-semibold mb-1">
              {now ? formatDuration(Math.floor((now - new Date(running.started_at).getTime()) / 1000)) : '…'}
            </div>
            <div className="text-sm text-neutral-400 mb-3">
              {clientName(running.client_id)}
              {running.task_id && ` · ${taskTitle(running.task_id)}`}
              {running.note && ` · ${running.note}`}
            </div>
            <button className="rounded bg-white text-black px-3 py-1.5 text-sm font-medium" onClick={stopTimer}>
              ■ Stop
            </button>
          </div>
        ) : (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Start a timer</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select
                className="rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
                value={timerClientId}
                onChange={(e) => {
                  setTimerClientId(e.target.value)
                  setTimerTaskId('')
                }}
              >
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className="rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
                value={timerTaskId}
                onChange={(e) => setTimerTaskId(e.target.value)}
                disabled={!timerClientId}
              >
                <option value="">No task</option>
                {timerTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
            <input
              className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-3"
              placeholder="What are you working on? (optional)"
              value={timerNote}
              onChange={(e) => setTimerNote(e.target.value)}
            />
            <button
              className="rounded bg-white text-black px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              onClick={startTimer}
              disabled={!timerClientId || starting}
            >
              ▶ Start
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Log time manually</div>
        <button className="text-xs text-neutral-400" onClick={() => setShowManual((v) => !v)}>
          {showManual ? 'Cancel' : '+ Add'}
        </button>
      </div>
      {showManual && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 mb-6">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <select
              className="rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
              value={manualClientId}
              onChange={(e) => {
                setManualClientId(e.target.value)
                setManualTaskId('')
              }}
            >
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
              value={manualTaskId}
              onChange={(e) => setManualTaskId(e.target.value)}
              disabled={!manualClientId}
            >
              <option value="">No task</option>
              {manualTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
            />
            <input
              type="number"
              step="0.25"
              min="0"
              className="rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
              placeholder="Hours (e.g. 1.5)"
              value={manualHours}
              onChange={(e) => setManualHours(e.target.value)}
            />
          </div>
          <input
            className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-2"
            placeholder="Note (optional)"
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={manualBillable} onChange={(e) => setManualBillable(e.target.checked)} />
            Billable
          </label>
          <button className="rounded bg-white text-black px-3 py-1.5 text-sm font-medium" onClick={addManualEntry}>
            Save entry
          </button>
        </div>
      )}

      {totalByClient.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Time by client</div>
          <div className="rounded-lg border border-white/10 divide-y divide-white/10">
            {totalByClient.map((r) => (
              <div key={r.client.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{r.client.name}</span>
                <span className="text-neutral-400">{formatHours(r.seconds)}h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && totalByMember.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Time by teammate</div>
          <div className="rounded-lg border border-white/10 divide-y divide-white/10">
            {totalByMember.map((r) => (
              <div key={r.member.user_id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{memberName(r.member)}</span>
                <span className="text-neutral-400">{formatHours(r.seconds)}h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Entries</div>
      {grouped.length === 0 && <div className="text-sm text-neutral-500 py-3">No time logged yet.</div>}
      {grouped.map((g) => (
        <div key={g.date} className="mb-4">
          <div className="text-xs text-neutral-500 mb-1">{g.date}</div>
          {g.items.map((e) => (
            <div key={e.id} className="flex items-center gap-3 py-2 border-b border-white/10 group">
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  {clientName(e.client_id)}
                  {e.task_id && <span className="text-neutral-500"> · {taskTitle(e.task_id)}</span>}
                  {!e.billable && <span className="ml-2 text-[10px] text-neutral-500">non-billable</span>}
                </div>
                {e.note && <div className="text-xs text-neutral-500">{e.note}</div>}
                {isAdmin && <div className="text-xs text-neutral-600">{memberEmail(e.user_id)}</div>}
              </div>
              <div className="text-sm text-neutral-400 shrink-0">{formatDuration(e.duration_seconds || 0)}</div>
              {(isAdmin || e.user_id === userId) && (
                <button className="text-xs text-red-400 opacity-0 group-hover:opacity-100 shrink-0" onClick={() => deleteEntry(e.id)}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
