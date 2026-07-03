'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { AVATAR_COLORS, formatDate, getInitials, memberName, todayKey } from '@/lib/agency'
import MetricBar from '@/components/ui/MetricBar'
import CustomSelect from '@/components/ui/CustomSelect'
import { useConfirm } from '@/components/ConfirmDialog'

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
type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null; role?: string; title?: string | null }

function Avatar({ member, index }: { member: Member; index: number }) {
  const name = memberName(member)
  if (member.avatar_url) return <img src={member.avatar_url} alt={name} className="h-8 w-8 rounded-full object-cover shrink-0" />
  return (
    <div
      className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
      style={{ background: AVATAR_COLORS[Math.abs(index) % AVATAR_COLORS.length] }}
    >
      {getInitials(name)}
    </div>
  )
}

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
  archivedTotals,
}: {
  orgId: string
  userId: string
  isAdmin: boolean
  clients: Client[]
  tasks: Task[]
  initialEntries: Entry[]
  members: Member[]
  archivedTotals: { client_id: string | null; user_id: string; seconds: number }[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()
  const [entries, setEntries] = useState<Entry[]>(initialEntries)
  const [localArchivedTotals, setLocalArchivedTotals] = useState(archivedTotals)
  const [now, setNow] = useState<number | null>(null)
  const PAGE_SIZE = 100
  const [fetchedCount, setFetchedCount] = useState(initialEntries.length)
  const [hasMore, setHasMore] = useState(initialEntries.length >= PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)

  // router.refresh() re-runs the server component and gives a new initialEntries array, but
  // useState's initializer only runs on mount — without this, the prop update never lands.
  useEffect(() => {
    setEntries(initialEntries)
    setFetchedCount(initialEntries.length)
    setHasMore(initialEntries.length >= PAGE_SIZE)
  }, [initialEntries])

  useEffect(() => {
    setLocalArchivedTotals(archivedTotals)
  }, [archivedTotals])

  async function loadMore() {
    setLoadingMore(true)
    const { data } = await supabase
      .from('time_entries')
      .select('*')
      .eq('org_id', orgId)
      .order('started_at', { ascending: false })
      .range(fetchedCount, fetchedCount + PAGE_SIZE - 1)
    if (data) {
      setEntries((prev) => [...prev, ...(data as Entry[])])
      setFetchedCount((prev) => prev + data.length)
      if (data.length < PAGE_SIZE) setHasMore(false)
    }
    setLoadingMore(false)
  }

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

  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set([todayKey().slice(0, 7)]))
  function toggleMonth(month: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editClientId, setEditClientId] = useState('')
  const [editTaskId, setEditTaskId] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editBillable, setEditBillable] = useState(true)

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

  function deleteEntry(id: string) {
    const removed = entries.find((e) => e.id === id)
    if (!removed) return
    setEntries((prev) => prev.filter((e) => e.id !== id))
    const timeoutId = setTimeout(async () => {
      await supabase.from('time_entries').delete().eq('id', id)
    }, 5000)
    toast('Time entry deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timeoutId)
          setEntries((prev) => [...prev, removed])
        },
      },
    })
  }

  function lastDayOfPrevMonth() {
    const d = new Date()
    d.setDate(0)
    return todayKey(d)
  }

  const [showClearOld, setShowClearOld] = useState(false)
  const [clearCutoff, setClearCutoff] = useState(lastDayOfPrevMonth())
  const [clearing, setClearing] = useState(false)
  const maxClearCutoff = lastDayOfPrevMonth()

  // Archives the totals of everything before the cutoff into time_archived_totals (so lifetime
  // client/teammate totals stay accurate — see clients/page.tsx and totalByClient/totalByMember
  // above) before deleting the raw rows. Cutoff is capped to the end of last month so the
  // current month — which Revenue reads live and month-scoped — can never be touched here.
  async function clearOldEntries() {
    if (!clearCutoff) return
    setClearing(true)
    try {
      const { data: toClear } = await supabase
        .from('time_entries')
        .select('id, client_id, user_id, duration_seconds, billable')
        .eq('org_id', orgId)
        .lt('started_at', `${clearCutoff}T00:00:00`)
        .not('duration_seconds', 'is', null)

      if (!toClear || toClear.length === 0) {
        toast('No entries before that date')
        return
      }

      const totalSeconds = toClear.reduce((s, e) => s + (e.duration_seconds || 0), 0)
      const ok = await confirm({
        title: 'Clear old time entries?',
        message: `This permanently deletes ${toClear.length} entr${toClear.length === 1 ? 'y' : 'ies'} totaling ${formatHours(totalSeconds)}h logged before ${formatDate(clearCutoff)}. Client and teammate totals will still include this time — only the individual entry detail is removed.`,
        confirmLabel: 'Delete entries',
        danger: true,
      })
      if (!ok) return

      type Agg = { client_id: string | null; user_id: string; seconds: number; billableSeconds: number }
      const totals = new Map<string, Agg>()
      for (const e of toClear) {
        const key = `${e.client_id ?? 'none'}|${e.user_id}`
        const agg = totals.get(key) || { client_id: e.client_id, user_id: e.user_id, seconds: 0, billableSeconds: 0 }
        agg.seconds += e.duration_seconds || 0
        if (e.billable) agg.billableSeconds += e.duration_seconds || 0
        totals.set(key, agg)
      }

      for (const agg of totals.values()) {
        let existingQuery = supabase.from('time_archived_totals').select('id, seconds, billable_seconds').eq('org_id', orgId).eq('user_id', agg.user_id)
        existingQuery = agg.client_id ? existingQuery.eq('client_id', agg.client_id) : existingQuery.is('client_id', null)
        const { data: existing } = await existingQuery.maybeSingle()
        if (existing) {
          await supabase
            .from('time_archived_totals')
            .update({
              seconds: existing.seconds + agg.seconds,
              billable_seconds: existing.billable_seconds + agg.billableSeconds,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
        } else {
          await supabase.from('time_archived_totals').insert({
            org_id: orgId,
            client_id: agg.client_id,
            user_id: agg.user_id,
            seconds: agg.seconds,
            billable_seconds: agg.billableSeconds,
          })
        }
      }

      const ids = toClear.map((e) => e.id)
      const chunkSize = 200
      for (let i = 0; i < ids.length; i += chunkSize) {
        await supabase.from('time_entries').delete().in('id', ids.slice(i, i + chunkSize))
      }

      setEntries((prev) => prev.filter((e) => !ids.includes(e.id)))
      setLocalArchivedTotals((prev) => {
        const next = [...prev]
        for (const agg of totals.values()) {
          const idx = next.findIndex((t) => t.client_id === agg.client_id && t.user_id === agg.user_id)
          if (idx >= 0) next[idx] = { ...next[idx], seconds: next[idx].seconds + agg.seconds }
          else next.push({ client_id: agg.client_id, user_id: agg.user_id, seconds: agg.seconds })
        }
        return next
      })
      setShowClearOld(false)
      toast.success(`Cleared ${toClear.length} entries (${formatHours(totalSeconds)}h)`)
    } finally {
      setClearing(false)
    }
  }

  function startEdit(e: Entry) {
    setEditingId(e.id)
    setEditClientId(e.client_id || '')
    setEditTaskId(e.task_id || '')
    setEditHours(e.duration_seconds ? (e.duration_seconds / 3600).toFixed(2) : '')
    setEditNote(e.note || '')
    setEditBillable(e.billable)
  }

  async function updateEntry(e: Entry) {
    const hours = parseFloat(editHours)
    if (!editClientId || !hours || hours <= 0) return
    const durationSeconds = Math.round(hours * 3600)
    const endedAt = new Date(new Date(e.started_at).getTime() + durationSeconds * 1000).toISOString()
    const { data } = await supabase
      .from('time_entries')
      .update({
        client_id: editClientId,
        task_id: editTaskId || null,
        duration_seconds: durationSeconds,
        ended_at: endedAt,
        note: editNote || null,
        billable: editBillable,
      })
      .eq('id', e.id)
      .select()
      .single()
    if (data) setEntries((prev) => prev.map((x) => (x.id === e.id ? (data as Entry) : x)))
    setEditingId(null)
  }

  function archivedSecondsFor(clientId: string | null, memberId?: string) {
    return localArchivedTotals
      .filter((t) => t.client_id === clientId && (memberId === undefined || t.user_id === memberId))
      .reduce((s, t) => s + t.seconds, 0)
  }

  const completed = entries.filter((e) => e.ended_at && e.duration_seconds)
  // Folds in time_archived_totals so a "Clear old entries" sweep never changes what these
  // summary cards show — only the raw per-entry list (below) shrinks.
  const totalByClient = clients
    .map((c) => ({
      client: c,
      seconds: completed.filter((e) => e.client_id === c.id).reduce((s, e) => s + (e.duration_seconds || 0), 0) + archivedSecondsFor(c.id),
    }))
    .filter((r) => r.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)

  const totalByMember = isAdmin
    ? members
        .map((m) => ({
          member: m,
          seconds:
            completed.filter((e) => e.user_id === m.user_id).reduce((s, e) => s + (e.duration_seconds || 0), 0) +
            localArchivedTotals.filter((t) => t.user_id === m.user_id).reduce((s, t) => s + t.seconds, 0),
        }))
        .filter((r) => r.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
    : []

  const timerTasks = tasks.filter((t) => t.client_id === timerClientId)
  const manualTasks = tasks.filter((t) => t.client_id === manualClientId)

  const monthGroups: { month: string; label: string; totalSeconds: number; days: { date: string; items: Entry[] }[] }[] = []
  for (const e of completed) {
    const date = e.started_at.slice(0, 10)
    const month = date.slice(0, 7)
    let mg = monthGroups.find((g) => g.month === month)
    if (!mg) {
      const [my, mm] = month.split('-').map(Number)
      mg = { month, label: new Date(my, mm - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), totalSeconds: 0, days: [] }
      monthGroups.push(mg)
    }
    mg.totalSeconds += e.duration_seconds || 0
    let day = mg.days.find((d) => d.date === date)
    if (!day) {
      day = { date, items: [] }
      mg.days.push(day)
    }
    day.items.push(e)
  }
  monthGroups.sort((a, b) => b.month.localeCompare(a.month))
  for (const mg of monthGroups) mg.days.sort((a, b) => b.date.localeCompare(a.date))

  function exportCsv() {
    const rows = [
      ['Date', 'Client', 'Task', 'Member', 'Hours', 'Billable', 'Note'],
      ...completed
        .slice()
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .map((e) => [
          e.started_at.slice(0, 10),
          clientName(e.client_id),
          taskTitle(e.task_id) || '',
          memberEmail(e.user_id),
          formatHours(e.duration_seconds || 0),
          e.billable ? 'Yes' : 'No',
          e.note || '',
        ]),
    ]
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `time-entries-${todayKey()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-5">Time</h1>

      <div className="rounded-lg border border-ink/10 bg-white p-4 mb-6">
        {running ? (
          <div>
            <div className="text-2xl font-mono font-semibold mb-1">
              {now ? formatDuration(Math.floor((now - new Date(running.started_at).getTime()) / 1000)) : '…'}
            </div>
            <div className="text-sm text-sage mb-3">
              {clientName(running.client_id)}
              {running.task_id && ` · ${taskTitle(running.task_id)}`}
              {running.note && ` · ${running.note}`}
            </div>
            <button className="rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={stopTimer}>
              ■ Stop
            </button>
          </div>
        ) : (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Start a timer</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <CustomSelect
                value={timerClientId}
                onChange={(v) => {
                  setTimerClientId(v)
                  setTimerTaskId('')
                }}
                options={[{ value: '', label: 'Select client…' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              />
              <CustomSelect
                value={timerTaskId}
                onChange={setTimerTaskId}
                disabled={!timerClientId}
                options={[{ value: '', label: 'No task' }, ...timerTasks.map((t) => ({ value: t.id, label: t.title }))]}
              />
            </div>
            <input
              className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-3"
              placeholder="What are you working on? (optional)"
              value={timerNote}
              onChange={(e) => setTimerNote(e.target.value)}
            />
            <button
              className="rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              onClick={startTimer}
              disabled={!timerClientId || starting}
            >
              ▶ Start
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-sage">Log time manually</div>
        <button className="text-xs text-sage" onClick={() => setShowManual((v) => !v)}>
          {showManual ? 'Cancel' : '+ Add'}
        </button>
      </div>
      {showManual && (
        <div className="rounded-lg border border-ink/10 bg-white p-4 mb-6">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <CustomSelect
              value={manualClientId}
              onChange={(v) => {
                setManualClientId(v)
                setManualTaskId('')
              }}
              options={[{ value: '', label: 'Select client…' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <CustomSelect
              value={manualTaskId}
              onChange={setManualTaskId}
              disabled={!manualClientId}
              options={[{ value: '', label: 'No task' }, ...manualTasks.map((t) => ({ value: t.id, label: t.title }))]}
            />
            <input
              type="date"
              className="rounded border border-ink/10 bg-white px-2 py-2 text-sm"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
            />
            <input
              type="number"
              step="0.25"
              min="0"
              className="rounded border border-ink/10 bg-white px-2 py-2 text-sm"
              placeholder="Hours (e.g. 1.5)"
              value={manualHours}
              onChange={(e) => setManualHours(e.target.value)}
            />
          </div>
          <input
            className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
            placeholder="Note (optional)"
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={manualBillable} onChange={(e) => setManualBillable(e.target.checked)} />
            Billable
          </label>
          <button className="rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={addManualEntry}>
            Save entry
          </button>
        </div>
      )}

      {totalByClient.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Time by client</div>
          <div className="rounded-lg border border-ink/10 divide-y divide-ink/10">
            {totalByClient.map((r) => (
              <div key={r.client.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{r.client.name}</span>
                <span className="text-sage">{formatHours(r.seconds)}h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && totalByMember.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Time by teammate</div>
          <div className="space-y-3">
            {totalByMember.map((r, i) => (
              <div key={r.member.user_id} className="rounded-2xl bg-white shadow-md p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar member={r.member} index={i} />
                  <div>
                    <div className="text-sm font-semibold">{memberName(r.member)}</div>
                    {r.member.role && (
                      <div className="text-xs text-sage capitalize">
                        {r.member.role}
                        {r.member.title && ` · ${r.member.title}`}
                      </div>
                    )}
                  </div>
                  <div className="ml-auto text-sm font-semibold">{formatHours(r.seconds)}h total</div>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                  {totalByClient.map((cr) => {
                    const seconds =
                      completed
                        .filter((e) => e.user_id === r.member.user_id && e.client_id === cr.client.id)
                        .reduce((s, e) => s + (e.duration_seconds || 0), 0) + archivedSecondsFor(cr.client.id, r.member.user_id)
                    return (
                      <div key={cr.client.id} className="flex-1 min-w-[100px]">
                        <div className="text-[10px] text-sage mb-1 truncate">{cr.client.name}</div>
                        <MetricBar value={seconds} max={cr.seconds} display={seconds > 0 ? `${formatHours(seconds)}h` : '—'} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-sage">Entries</div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button onClick={() => setShowClearOld((v) => !v)} className="text-xs text-sage hover:text-ink transition-colors">
              {showClearOld ? 'Cancel' : 'Clear old entries'}
            </button>
          )}
          {completed.length > 0 && (
            <button onClick={exportCsv} className="text-xs text-sage hover:text-ink transition-colors">
              Export CSV
            </button>
          )}
        </div>
      </div>
      {showClearOld && (
        <div className="rounded-lg border border-ink/10 bg-white p-4 mb-4">
          <div className="text-xs text-sage mb-2">
            Permanently delete entries logged before a chosen date. Client and teammate totals stay accurate — only the individual entry
            detail is removed. The current month can&apos;t be cleared this way.
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="rounded border border-ink/10 bg-white px-2 py-2 text-sm"
              value={clearCutoff}
              max={maxClearCutoff}
              onChange={(e) => setClearCutoff(e.target.value > maxClearCutoff ? maxClearCutoff : e.target.value)}
            />
            <button
              className="rounded bg-red-600 text-white shadow-md px-3 py-2 text-sm font-medium disabled:opacity-50"
              onClick={clearOldEntries}
              disabled={clearing || !clearCutoff}
            >
              {clearing ? 'Clearing…' : 'Clear entries before this date'}
            </button>
          </div>
        </div>
      )}
      {monthGroups.length === 0 && <div className="text-sm text-sage py-3">No time logged yet.</div>}
      {monthGroups.map((mg) => {
        const expanded = expandedMonths.has(mg.month)
        return (
          <div key={mg.month} className="mb-4">
            <button
              type="button"
              className="w-full flex items-center justify-between py-1.5 text-left"
              onClick={() => toggleMonth(mg.month)}
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-sage">
                {expanded ? '▾' : '▸'} {mg.label}
              </span>
              <span className="text-xs text-sage">{formatHours(mg.totalSeconds)}h</span>
            </button>
            {expanded &&
              mg.days.map((g) => (
                <div key={g.date} className="mb-3 pl-3">
                  <div className="text-xs text-sage mb-1">{g.date}</div>
                  {g.items.map((e) => {
                    const canEdit = isAdmin || e.user_id === userId
                    if (editingId === e.id) {
                      const editTasks = tasks.filter((t) => t.client_id === editClientId)
                      return (
                        <div key={e.id} className="rounded-lg border border-ink/10 bg-white p-3 mb-2">
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <CustomSelect
                              value={editClientId}
                              onChange={(v) => {
                                setEditClientId(v)
                                setEditTaskId('')
                              }}
                              options={[{ value: '', label: 'Select client…' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                            />
                            <CustomSelect
                              value={editTaskId}
                              onChange={setEditTaskId}
                              disabled={!editClientId}
                              options={[{ value: '', label: 'No task' }, ...editTasks.map((t) => ({ value: t.id, label: t.title }))]}
                            />
                            <input
                              type="number"
                              step="0.25"
                              min="0"
                              className="rounded border border-ink/10 bg-white px-2 py-2 text-sm"
                              placeholder="Hours"
                              value={editHours}
                              onChange={(ev) => setEditHours(ev.target.value)}
                            />
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={editBillable} onChange={(ev) => setEditBillable(ev.target.checked)} />
                              Billable
                            </label>
                          </div>
                          <input
                            className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
                            placeholder="Note (optional)"
                            value={editNote}
                            onChange={(ev) => setEditNote(ev.target.value)}
                          />
                          <div className="flex gap-2">
                            <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={() => setEditingId(null)}>
                              Cancel
                            </button>
                            <button className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={() => updateEntry(e)}>
                              Save
                            </button>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div key={e.id} className="flex items-center gap-3 py-2 border-b border-ink/10 group">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">
                            {clientName(e.client_id)}
                            {e.task_id && <span className="text-sage"> · {taskTitle(e.task_id)}</span>}
                            {!e.billable && <span className="ml-2 text-[10px] text-sage">non-billable</span>}
                          </div>
                          {e.note && <div className="text-xs text-sage">{e.note}</div>}
                          {isAdmin && <div className="text-xs text-sage/70">{memberEmail(e.user_id)}</div>}
                        </div>
                        <div className="text-sm text-sage shrink-0">{formatDuration(e.duration_seconds || 0)}</div>
                        {canEdit && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 shrink-0">
                            <button className="text-xs text-sage px-1" onClick={() => startEdit(e)}>
                              ✏
                            </button>
                            <button className="text-xs text-red-600 px-1" onClick={() => deleteEntry(e.id)}>
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
          </div>
        )
      })}
      {hasMore && (
        <button
          className="w-full text-center text-xs text-sage hover:text-ink py-2 disabled:opacity-50"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
