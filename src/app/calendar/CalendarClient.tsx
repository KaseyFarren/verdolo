'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatDate, todayKey } from '@/lib/agency'

type Client = { id: string; name: string }
type Task = { id: string; client_id: string | null; title: string; due_date: string; done: boolean; priority: string }

export default function CalendarClient({
  orgId,
  initialClients,
  initialTasks,
}: {
  orgId: string
  initialClients: Client[]
  initialTasks: Task[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [calDate, setCalDate] = useState(todayKey())
  const [newTitle, setNewTitle] = useState('')
  const today = todayKey()

  // router.refresh() (e.g. after the global quick-capture modal adds a task from any page)
  // re-runs the server component and gives us a new initialTasks array, but useState's
  // initializer only runs on mount — without this, the prop update never reaches local state.
  useEffect(() => {
    setTasks(initialTasks)
  }, [initialTasks])

  const [calY, calM] = calDate.split('-').map(Number).slice(0, 2).map((v, i) => (i === 1 ? v - 1 : v))
  const firstDay = new Date(calY, calM, 1).getDay()
  const daysInMonth = new Date(calY, calM + 1, 0).getDate()
  const selectedDay = parseInt(calDate.split('-')[2], 10)

  function prevMonth() {
    const d = new Date(calY, calM - 1, 1)
    setCalDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }
  function nextMonth() {
    const d = new Date(calY, calM + 1, 1)
    setCalDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }
  function selectDay(d: number) {
    setCalDate(`${calY}-${String(calM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  function taskCountForDay(d: number) {
    const k = `${calY}-${String(calM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return tasks.filter((t) => t.due_date === k && !t.done).length
  }
  const clientName = (id: string | null) => initialClients.find((c) => c.id === id)?.name || ''
  const calTasks = tasks.filter((t) => t.due_date === calDate)

  async function addTask() {
    if (!newTitle.trim()) return
    const { data } = await supabase
      .from('tasks')
      .insert({ org_id: orgId, title: newTitle, due_date: calDate, priority: 'Medium', done: false, quick: true })
      .select()
      .single()
    if (data) setTasks((prev) => [...prev, data as Task])
    setNewTitle('')
  }
  async function toggleTask(t: Task) {
    const { data } = await supabase
      .from('tasks')
      .update({ done: !t.done, completed_at: !t.done ? new Date().toISOString() : null })
      .eq('id', t.id)
      .select()
      .single()
    if (data) setTasks((prev) => prev.map((x) => (x.id === t.id ? (data as Task) : x)))
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

  return (
    <div>
      <h1 className="text-xl font-semibold mb-5">Calendar</h1>

      <div className="rounded-lg border border-white/10 bg-white/5 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={prevMonth} className="text-neutral-400 px-2">
            ‹
          </button>
          <div className="text-sm font-medium">{new Date(calY, calM).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
          <button onClick={nextMonth} className="text-neutral-400 px-2">
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-center text-[11px] text-neutral-500 py-1">
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
              const k = `${calY}-${String(calM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
              const isToday = k === today
              const isSel = d === selectedDay
              const cnt = taskCountForDay(d)
              return (
                <div
                  key={d}
                  onClick={() => selectDay(d)}
                  className={`text-center py-1.5 rounded-md cursor-pointer ${isSel ? 'bg-white text-black' : isToday ? 'bg-white/10' : ''}`}
                >
                  <div className={`text-sm ${isSel ? 'font-semibold' : isToday ? 'text-white font-medium' : ''}`}>{d}</div>
                  {cnt > 0 && <div className={`h-1 w-1 rounded-full mx-auto mt-0.5 ${isSel ? 'bg-black/60' : 'bg-white/60'}`} />}
                </div>
              )
            })}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">{formatDate(calDate)}</div>
      </div>
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 rounded border border-white/10 bg-black/30 px-3 py-2 text-sm"
          placeholder="Add a task for this day…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTask()}
        />
        <button className="rounded bg-white text-black px-3 py-2 text-sm font-medium" onClick={addTask}>
          Add
        </button>
      </div>

      {calTasks.length === 0 ? (
        <div className="text-sm text-neutral-500 py-4">No tasks scheduled.</div>
      ) : (
        calTasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2 border-b border-white/10 group">
            <button
              onClick={() => toggleTask(t)}
              className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${t.done ? 'bg-emerald-500 border-emerald-500' : 'border-neutral-500'}`}
            >
              {t.done && <span className="text-[10px] text-black">✓</span>}
            </button>
            <div className="flex-1 min-w-0">
              <div className={`text-sm ${t.done ? 'line-through text-neutral-500' : ''}`}>{t.title}</div>
              {t.client_id && <div className="text-xs text-neutral-500">{clientName(t.client_id)}</div>}
            </div>
            <button className="text-xs text-red-400 opacity-0 group-hover:opacity-100" onClick={() => deleteTask(t.id)}>
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  )
}
