'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import { XIcon } from '@/components/ui/icons'
import TaskComments from '@/components/tasks/TaskComments'
import DatePicker from '@/components/ui/DatePicker'
import Switch from '@/components/ui/Switch'
import { formatDate, todayKey } from '@/lib/agency'
import { notifyOther } from '@/lib/notifyClient'

export type PortalTask = {
  id: string
  title: string
  done: boolean
  due_date: string | null
  completed_at: string | null
  phase_id: string | null
  project_id: string | null
  for_client: boolean
  client_visible: boolean
  requested_by: string | null
  notes: string | null
  created_at: string
}
export type PortalPhase = { id: string; name: string; sort_order: number; project_id: string }
export type PortalProject = { id: string; name: string; description: string | null; status: string; due_date: string | null }

const STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' }
const INPUT = 'w-full rounded-[10px] border border-ink/10 bg-white px-3 py-2.5 text-[15px] outline-none focus:outline-none focus:ring-0 focus:border-ink/25'

function addDaysIso(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function DueTag({ due, done, today }: { due: string | null; done?: boolean; today: string }) {
  if (!due || done) return null
  if (due < today) return <span className="text-xs font-medium text-red-600 shrink-0">Overdue · {formatDate(due)}</span>
  if (due === today) return <span className="text-xs font-medium text-accent shrink-0">Today</span>
  return <span className="text-xs text-sage shrink-0">{formatDate(due)}</span>
}

/** Small app-styled show/hide (instead of a native <details> disclosure). */
function Reveal({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-sage hover:text-ink outline-none flex items-center gap-1">
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        {label}
      </button>
      {open && children}
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white border border-ink/8 p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && <p className="text-xs text-sage mt-0.5">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export default function PortalHome({
  orgId,
  userId,
  clientName,
  contactName,
  teamName,
  projects,
  phases,
  tasks: initialTasks,
  dailyDigest,
  digestJustOff,
  openTaskId,
}: {
  orgId: string
  userId: string
  clientName: string
  contactName: string | null
  teamName: string
  projects: PortalProject[]
  phases: PortalPhase[]
  tasks: PortalTask[]
  dailyDigest: boolean
  digestJustOff: boolean
  openTaskId: string | null
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const today = todayKey()
  const [tasks, setTasks] = useState(initialTasks)
  const [detailId, setDetailId] = useState<string | null>(openTaskId && initialTasks.some((t) => t.id === openTaskId) ? openTaskId : null)
  const [digest, setDigest] = useState(dailyDigest)

  // Ask-for-something form
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [adding, setAdding] = useState(false)

  const byDue = (a: PortalTask, b: PortalTask) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')
  const weekAhead = addDaysIso(today, 7)
  const [recentCutoff] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString())

  const waiting = tasks.filter((t) => t.for_client && !t.done).sort(byDue)
  const waitingDoneRecently = tasks.filter((t) => t.for_client && t.done && (t.completed_at ?? '') >= recentCutoff)
  const requests = tasks.filter((t) => t.requested_by && !t.for_client)
  const openRequests = requests.filter((t) => !t.done).sort(byDue)
  const doneRequests = requests.filter((t) => t.done).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, 5)
  const teamWeek = tasks.filter((t) => !t.for_client && !t.requested_by && !t.done && t.due_date && t.due_date <= weekAhead).sort(byDue)
  const teamDoneRecently = tasks
    .filter((t) => !t.for_client && !t.requested_by && t.done && (t.completed_at ?? '') >= recentCutoff)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const teamWeekIds = new Set(teamWeek.map((t) => t.id))
  // Regular jobs outside a project, minus anything already listed under "working on" this week.
  const ongoing = tasks.filter((t) => !t.project_id && t.client_visible && !t.for_client && !t.requested_by && !teamWeekIds.has(t.id))
  const detail = tasks.find((t) => t.id === detailId) ?? null

  async function toggleDone(t: PortalTask) {
    const next = !t.done
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: next, completed_at: next ? new Date().toISOString() : null } : x)))
    const { error } = await supabase.rpc('client_set_task_done', { p_task_id: t.id, p_done: next })
    if (error) {
      setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)))
      toast.error('Could not update that - please try again')
      return
    }
    if (next) {
      toast.success('Ticked off')
      notifyOther('client_done', t.id)
    }
  }

  async function addRequest() {
    const clean = title.trim()
    if (!clean || adding) return
    setAdding(true)
    const { data: id, error } = await supabase.rpc('client_add_task', { p_title: clean, p_notes: notes.trim() || null, p_due: due || null })
    setAdding(false)
    if (error || !id) {
      toast.error('Could not add that - please try again')
      return
    }
    notifyOther('client_task', id as string)
    toast.success(`Sent to ${teamName}`)
    setTitle('')
    setDue('')
    setNotes('')
    setShowNotes(false)
    router.refresh()
    const { data: row } = await supabase
      .from('tasks')
      .select('id, title, done, due_date, completed_at, phase_id, project_id, for_client, client_visible, requested_by, notes, created_at')
      .eq('id', id as string)
      .maybeSingle()
    if (row) setTasks((prev) => [...prev, row as PortalTask])
  }

  async function setDigestPref(on: boolean) {
    setDigest(on)
    const { error } = await supabase.from('client_users').update({ daily_digest: on }).eq('user_id', userId)
    if (error) {
      setDigest(!on)
      toast.error('Could not save that')
    }
  }

  function Row({ t, tickable, showDue = true }: { t: PortalTask; tickable?: boolean; showDue?: boolean }) {
    return (
      <li className="flex items-center gap-3 py-2 border-b border-ink/6 last:border-b-0">
        {tickable ? (
          <button
            type="button"
            onClick={() => toggleDone(t)}
            aria-label={t.done ? `Mark "${t.title}" as not done` : `Tick off "${t.title}"`}
            className={`w-6 h-6 rounded-full border-2 shrink-0 flex items-center justify-center outline-none ${t.done ? 'bg-accent border-accent text-white' : 'border-ink/30 hover:border-accent'}`}
          >
            {t.done && <span className="text-xs leading-none">✓</span>}
          </button>
        ) : (
          <span className={`inline-block w-3 h-3 rounded-full shrink-0 ${t.done ? 'bg-accent' : 'border-2 border-ink/25'}`} />
        )}
        <button type="button" onClick={() => setDetailId(t.id)} className={`flex-1 min-w-0 text-left text-[15px] outline-none hover:underline ${t.done ? 'line-through text-sage' : ''}`}>
          {t.title}
        </button>
        {showDue && <DueTag due={t.due_date} done={t.done} today={today} />}
      </li>
    )
  }

  const first = contactName?.split(' ')[0]

  return (
    <div className="flex flex-col gap-4">
      <div className="px-1">
        <h1 className="text-xl font-semibold">{first ? `Hi ${first}` : `Welcome`}</h1>
        <p className="text-sm text-sage">Everything for {clientName} in one list, shared with {teamName}.</p>
      </div>

      {digestJustOff && (
        <div className="rounded-xl bg-sand px-4 py-3 text-sm">Morning emails are off. You can switch them back on at the bottom of this page.</div>
      )}

      <Card title="Waiting on you" subtitle={waiting.length ? `Tick each one off when it’s done - ${teamName} will see it straight away.` : undefined}>
        {waiting.length === 0 ? (
          <p className="text-sm text-sage">Nothing waiting on you right now.</p>
        ) : (
          <ul>{waiting.map((t) => <Row key={t.id} t={t} tickable />)}</ul>
        )}
        {waitingDoneRecently.length > 0 && (
          <Reveal label={`Done this week (${waitingDoneRecently.length})`}>
            <ul className="mt-1">{waitingDoneRecently.map((t) => <Row key={t.id} t={t} tickable showDue={false} />)}</ul>
          </Reveal>
        )}
      </Card>

      <Card title={`Ask ${teamName} for something`} subtitle="It goes straight onto the task list and you’ll see when it’s done.">
        <div className="flex flex-col gap-2">
          <input
            className={INPUT}
            placeholder="What do you need?"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !showNotes && addRequest()}
          />
          {showNotes ? (
            <textarea className={`${INPUT} min-h-[80px]`} placeholder="Any details that help" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          ) : (
            <button type="button" onClick={() => setShowNotes(true)} className="self-start text-xs text-sage hover:text-ink outline-none">
              + Add details
            </button>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-xs text-sage flex items-center gap-2">
              Needed by
              <DatePicker value={due} onChange={setDue} min={today} placeholder="Any time" />
            </div>
            <div className="flex-1" />
            <Button variant="primary" disabled={!title.trim() || adding} onClick={addRequest}>
              {adding ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
        {(openRequests.length > 0 || doneRequests.length > 0) && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-sage uppercase tracking-wide mb-1">Your requests</h3>
            <ul>
              {openRequests.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2 border-b border-ink/6 last:border-b-0">
                  <span className="text-[11px] font-medium text-sage bg-sand rounded-full px-2 py-0.5 shrink-0">With {teamName}</span>
                  <button type="button" onClick={() => setDetailId(t.id)} className="flex-1 min-w-0 text-left text-[15px] outline-none hover:underline">
                    {t.title}
                  </button>
                  <DueTag due={t.due_date} today={today} />
                </li>
              ))}
              {doneRequests.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2 border-b border-ink/6 last:border-b-0">
                  <span className="text-[11px] font-medium text-green bg-green/10 rounded-full px-2 py-0.5 shrink-0">Done</span>
                  <button type="button" onClick={() => setDetailId(t.id)} className="flex-1 min-w-0 text-left text-[15px] text-sage outline-none hover:underline">
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title={`What ${teamName} is working on`} subtitle="Due in the next 7 days">
        {teamWeek.length === 0 ? <p className="text-sm text-sage">Nothing due this week.</p> : <ul>{teamWeek.map((t) => <Row key={t.id} t={t} />)}</ul>}
        {teamDoneRecently.length > 0 && (
          <Reveal label={`Done in the last 7 days (${teamDoneRecently.length})`}>
            <ul className="mt-1">{teamDoneRecently.map((t) => <Row key={t.id} t={t} showDue={false} />)}</ul>
          </Reveal>
        )}
      </Card>

      {projects.map((project) => {
        const projectPhases = phases.filter((ph) => ph.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order)
        const projectTasks = tasks.filter((t) => t.project_id === project.id && !t.requested_by)
        const unphased = projectTasks.filter((t) => !t.phase_id)
        const done = projectTasks.filter((t) => t.done).length
        const pct = projectTasks.length ? Math.round((done / projectTasks.length) * 100) : 0
        return (
          <section key={project.id} className="rounded-2xl bg-white border border-ink/8 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h2 className="text-base font-semibold">{project.name}</h2>
              <span className="text-xs text-sage px-2 py-1 rounded-full bg-sand">{STATUS_LABEL[project.status] ?? project.status}</span>
            </div>
            <div className="text-xs text-sage mt-1 flex items-center gap-2 flex-wrap">
              {project.due_date && <span>Due {formatDate(project.due_date)}</span>}
              {projectTasks.length > 0 && (
                <span>
                  {done} of {projectTasks.length} done
                </span>
              )}
            </div>
            {projectTasks.length > 0 && (
              <div className="h-1.5 rounded-full bg-sand mt-2 overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
              </div>
            )}
            {project.description && <p className="text-sm text-sage mt-3 whitespace-pre-wrap">{project.description}</p>}
            <div className="flex flex-col gap-4 mt-3">
              {[...projectPhases.map((ph) => ({ key: ph.id, name: ph.name, items: projectTasks.filter((t) => t.phase_id === ph.id) })), { key: 'other', name: projectPhases.length ? 'Other' : 'Tasks', items: unphased }]
                .filter((g) => g.items.length)
                .map((g) => (
                  <div key={g.key}>
                    <h3 className="text-xs font-semibold text-sage uppercase tracking-wide mb-1">{g.name}</h3>
                    <ul>
                      {g.items.sort(byDue).map((t) => (
                        <div key={t.id} className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <Row t={t} tickable={t.for_client} />
                          </div>
                          {t.for_client && <span className="text-[11px] font-medium text-amber-800 bg-amber-100 rounded-full px-2 py-0.5 shrink-0">For you</span>}
                        </div>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </section>
        )
      })}

      {ongoing.length > 0 && (
        <Card title="Ongoing" subtitle="Regular jobs and other things outside a project">
          <ul>
            {ongoing
              .filter((t) => !t.done || (t.completed_at ?? '') >= recentCutoff)
              .sort(byDue)
              .map((t) => (
                <Row key={t.id} t={t} />
              ))}
          </ul>
        </Card>
      )}

      {projects.length === 0 && tasks.length === 0 && (
        <p className="text-sm text-sage px-1">Nothing here yet. Once {teamName} adds your project, it’ll show up on this page.</p>
      )}

      <Switch className="px-1 pb-4 text-sage" checked={digest} onChange={setDigestPref} label="Email me a short summary each morning" />

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-start sm:justify-center sm:pt-[8vh]" onClick={() => setDetailId(null)}>
          <div
            className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl p-5 max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={detail.title}
          >
            <div className="flex items-start gap-3 mb-2">
              <h2 className={`flex-1 text-lg font-semibold ${detail.done ? 'line-through text-sage' : ''}`}>{detail.title}</h2>
              <button type="button" onClick={() => setDetailId(null)} className="text-sage hover:text-ink outline-none p-1" aria-label="Close">
                <XIcon size={18} />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs text-sage mb-3">
              {detail.done ? (
                <span className="font-medium text-green">Done</span>
              ) : detail.for_client ? (
                <span className="font-medium text-amber-800">Waiting on you</span>
              ) : (
                <span>With {teamName}</span>
              )}
              {detail.due_date && !detail.done && (
                <>
                  <span>·</span>
                  <DueTag due={detail.due_date} today={today} />
                </>
              )}
            </div>
            {detail.requested_by && detail.notes && <p className="text-sm whitespace-pre-wrap mb-3">{detail.notes}</p>}
            {detail.for_client && (
              <div className="mb-4">
                <Button variant={detail.done ? 'secondary' : 'primary'} onClick={() => toggleDone(detail)}>
                  {detail.done ? 'Mark as not done' : 'Tick it off'}
                </Button>
              </div>
            )}
            <div className="border-t border-ink/8 pt-3">
              <TaskComments supabase={supabase} taskId={detail.id} orgId={orgId} userId={userId} placeholder={`Ask ${teamName} a question or add a note…`} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
