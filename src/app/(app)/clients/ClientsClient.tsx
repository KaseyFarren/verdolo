'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import ClientFiles from '@/components/ClientFiles'
import ClientUpdateModal from '@/components/clients/ClientUpdateModal'
import Button from '@/components/ui/Button'
import CustomSelect from '@/components/ui/CustomSelect'
import DatePicker from '@/components/ui/DatePicker'
import PeriodSelector from '@/components/ui/PeriodSelector'
import Tooltip from '@/components/ui/Tooltip'
import { CheckIcon, ClockIcon, MessageCircleIcon, PauseIcon, PencilIcon, PlayIcon, SparkleIcon, XIcon } from '@/components/ui/icons'
import { periodBounds, daysUntilRenewal, type PeriodValue } from '@/lib/period'
import {
  AVATAR_COLORS,
  PLATFORMS,
  STAGES,
  TONES,
  cadenceLabel,
  centsToDollars,
  clientHealthKey,
  currencySymbol,
  dollarsToCents,
  formatDate,
  formatNoteTime,
  getInitials,
  getStage,
  HEALTH_COLOR,
  HEALTH_LABEL,
  memberName,
  stageColor,
  stageLabel,
  todayKey,
  type Currency,
} from '@/lib/agency'

type Client = {
  id: string
  name: string
  business: string | null
  platform: string | null
  service: string | null
  notes: string | null
  tone: string | null
  talking_points: string | null
  cadence_days: number | null
  stage: string | null
  status: string | null
  retainer_cents: number | null
  retainer_hours: number | null
  billing_mode: string | null
  hourly_rate_cents: number | null
  billing_day: number | null
  contract_ends: string | null
  last_contacted: string | null
  quick_note: string | null
  awaiting_reply: boolean
  contact_email: string | null
  contact_domain: string | null
  primary_contact_id: string | null
}
type Note = { id: string; client_id: string; text: string; created_at: string; author_id: string | null }
type CompletedTask = { id: string; client_id: string | null; title: string; completed_at: string; assigned_to: string | null }
type AiMessage = { id: string; client_id: string | null; message: string | null; created_at: string; generated_by: string | null }
type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null }
type HealthSnapshot = { client_id: string; snapshot_date: string; health: 'green' | 'amber' | 'red' | 'churned' }
type ClientBurn = { hoursBudget: number; hoursLogged: number; percent: number; status: 'ok' | 'warn' | 'high' | 'over' }

const STAGE_TOOLTIP = 'Pipeline stage - where this client sits in your funnel. Set manually, doesn’t change on its own.'
const HEALTH_TOOLTIP = 'Contact health - how overdue this client is for a check-in, based on last contact vs. their cadence. Independent of pipeline stage.'

const emptyForm = {
  name: '',
  business: '',
  platform: '',
  service: '',
  notes: '',
  tone: 'Friendly',
  talking_points: '',
  cadence_days: 7,
  stage: 'Active',
  billing_mode: 'retainer',
  retainer: '',
  retainer_hours: '',
  hourly_rate: '',
  billing_day: 1,
  contract_ends: '',
  contact_email: '',
  contact_domain: '',
  owner: '',
}

export default function ClientsClient({
  orgId,
  userId,
  canEdit,
  initialClients,
  initialNotes,
  completedTasks,
  aiMessages,
  timeEntries,
  archivedTimeTotals,
  members,
  healthSnapshots,
  clientBurn,
  currency,
}: {
  orgId: string
  userId: string
  canEdit: boolean
  initialClients: Client[]
  initialNotes: Note[]
  completedTasks: CompletedTask[]
  aiMessages: AiMessage[]
  timeEntries: { client_id: string | null; duration_seconds: number | null }[]
  archivedTimeTotals: { client_id: string | null; seconds: number }[]
  members: Member[]
  healthSnapshots: HealthSnapshot[]
  clientBurn: Record<string, ClientBurn>
  currency?: Currency
}) {
  const currencySign = currencySymbol(currency)
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [notes, setNotes] = useState<Note[]>(initialNotes)

  // router.refresh() gives a new initialClients/initialNotes array, but useState's initializer
  // only runs on mount - without this, the prop update never reaches local state.
  useEffect(() => {
    setClients(initialClients)
  }, [initialClients])
  useEffect(() => {
    setNotes(initialNotes)
  }, [initialNotes])

  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Live-sync clients created/edited/deleted by teammates so this page never needs a manual
  // refresh. Own optimistic changes echo back here too (Postgres Changes fires for the sender
  // as well) - INSERT dedupes by id, UPDATE/DELETE are idempotent against already-applied state.
  useEffect(() => {
    const channel = supabase
      .channel(`clients-org-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clients', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Client
        setClients((prev) => (prev.some((c) => c.id === incoming.id) ? prev : [...prev, incoming]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clients', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Client
        setClients((prev) => prev.map((c) => (c.id === incoming.id ? incoming : c)))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'clients', filter: `org_id=eq.${orgId}` }, (payload) => {
        const old = payload.old as { id: string }
        setClients((prev) => prev.filter((c) => c.id !== old.id))
        setSelectedId((prev) => (prev === old.id ? null : prev))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId, supabase])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string, unknown>>(emptyForm)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, unknown>>({})
  const [noteInput, setNoteInput] = useState('')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [timelineType, setTimelineType] = useState<'all' | 'note' | 'task' | 'message'>('all')
  const [timelinePeriod, setTimelinePeriod] = useState<PeriodValue>({ period: 'all_time' })
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const today = todayKey()
  const selected = clients.find((c) => c.id === selectedId) || null
  const memberById = (id: string | null) => members.find((m) => m.user_id === id) || null

  // Includes time_archived_totals so a "Clear old entries" sweep on the Time page (which rolls
  // up and deletes raw time_entries rows) never changes a client's lifetime hours shown here.
  function clientHoursSeconds(clientId: string) {
    const live = timeEntries.filter((e) => e.client_id === clientId).reduce((s, e) => s + (e.duration_seconds || 0), 0)
    const archived = archivedTimeTotals.filter((e) => e.client_id === clientId).reduce((s, e) => s + e.seconds, 0)
    return live + archived
  }

  function clientHealthTrend(clientId: string) {
    return healthSnapshots.filter((s) => s.client_id === clientId).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  }

  async function addClient() {
    const name = (form.name as string) || ''
    if (!name.trim()) return
    const isHourly = form.billing_mode === 'hourly'
    // Optimistic: id is client-generated, so show the client and clear the form immediately.
    const id = crypto.randomUUID()
    const insertRow = {
      id,
      org_id: orgId,
      name,
      business: form.business as string,
      platform: (form.platform as string) || null,
      service: form.service as string,
      notes: form.notes as string,
      tone: form.tone as string,
      talking_points: form.talking_points as string,
      cadence_days: form.cadence_days as number,
      stage: form.stage as string,
      billing_mode: (form.billing_mode as string) || 'retainer',
      retainer_cents: isHourly ? 0 : dollarsToCents((form.retainer as string) || '0'),
      retainer_hours: isHourly ? null : (form.retainer_hours ? Number(form.retainer_hours) : null),
      hourly_rate_cents: isHourly ? dollarsToCents((form.hourly_rate as string) || '0') : 0,
      billing_day: Math.min(31, Math.max(1, Number(form.billing_day) || 1)),
      contract_ends: (form.contract_ends as string) || null,
      contact_email: (form.contact_email as string) || null,
      contact_domain: (form.contact_domain as string) || null,
      primary_contact_id: (form.owner as string) || null,
      added_date: today,
    }
    const optimisticClient: Client = { ...insertRow, status: null, last_contacted: null, quick_note: null, awaiting_reply: false }
    setClients((prev) => [...prev, optimisticClient].sort((a, b) => a.name.localeCompare(b.name)))
    setForm(emptyForm)
    setShowAdd(false)
    const { data, error } = await supabase.from('clients').insert(insertRow).select().single()
    if (error) {
      setClients((prev) => prev.filter((c) => c.id !== id))
      toast.error('Could not add that client')
      return
    }
    toast.success(`${name} added`)
    if (data) setClients((prev) => prev.map((c) => (c.id === id ? (data as Client) : c)))
  }

  async function updateClient(id: string, fields: Record<string, unknown>) {
    // Optimistic: apply the edit locally, capturing the pre-edit row (inside the updater so rapid
    // successive edits each roll back to their own true prior state) for rollback on failure.
    let prevClient: Client | undefined
    setClients((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c
        prevClient = c
        return { ...c, ...fields } as Client
      }),
    )
    setEditing(false)
    const { data, error } = await supabase.from('clients').update(fields).eq('id', id).select().single()
    if (error) {
      if (prevClient) setClients((prev) => prev.map((c) => (c.id === id ? (prevClient as Client) : c)))
      toast.error('Could not save that change')
      return
    }
    if (data) setClients((prev) => prev.map((c) => (c.id === id ? (data as Client) : c)))
  }

  async function deleteClient(id: string) {
    const name = clients.find((c) => c.id === id)?.name ?? 'this client'
    const ok = await confirm({
      title: `Delete ${name}?`,
      message: 'This will also remove their tasks. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    // Optimistic: drop the client immediately, restoring the full prior list if the delete fails.
    let snapshot: Client[] = []
    setClients((prev) => {
      snapshot = prev
      return prev.filter((c) => c.id !== id)
    })
    setSelectedId(null)
    // tasks.client_id is "on delete set null" against clients, so deleting the client first
    // would null it out on every one of their tasks before this could match them (same ordering
    // hazard fixed for deleteRecurring/deleteDefault in TasksClient.tsx) - delete the tasks
    // first, while client_id is still intact, then the client.
    await supabase.from('tasks').delete().eq('client_id', id)
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) {
      setClients(snapshot)
      toast.error('Could not delete that client')
      return
    }
    toast.success(`${name} deleted`)
  }

  async function addNote(clientId: string, text: string) {
    if (!text.trim()) return
    const trimmed = text.trim()
    // Optimistic: id is client-generated, so show the note and clear the input immediately.
    const id = crypto.randomUUID()
    const optimisticNote: Note = { id, client_id: clientId, text: trimmed, created_at: new Date().toISOString(), author_id: userId }
    setNotes((prev) => [optimisticNote, ...prev])
    setNoteInput('')
    const { data, error } = await supabase
      .from('client_notes')
      .insert({ id, org_id: orgId, client_id: clientId, author_id: userId, text: trimmed })
      .select()
      .single()
    if (error) {
      setNotes((prev) => prev.filter((n) => n.id !== id))
      toast.error('Could not add that note')
      return
    }
    if (data) setNotes((prev) => prev.map((n) => (n.id === id ? (data as Note) : n)))
  }
  async function deleteNote(id: string) {
    const ok = await confirm({
      title: 'Delete this note?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    // Optimistic: drop the note immediately, restoring the full prior list if the delete fails.
    let snapshot: Note[] = []
    setNotes((prev) => {
      snapshot = prev
      return prev.filter((n) => n.id !== id)
    })
    const { error } = await supabase.from('client_notes').delete().eq('id', id)
    if (error) {
      setNotes(snapshot)
      toast.error('Could not delete that note')
    }
  }

  if (selected) {
    const stage = getStage(selected)
    const isChurned = stage === 'Churned'
    const health = clientHealthKey(selected, today)
    const dotColor = HEALTH_COLOR[health]
    const sColor = stageColor(stage)
    const clientNotes = notes.filter((n) => n.client_id === selected.id)
    const clientTasks = completedTasks.filter((t) => t.client_id === selected.id)
    const clientMessages = aiMessages.filter((m) => m.client_id === selected.id && m.message)
    const fullTimeline = [
      ...clientNotes.map((n) => ({ type: 'note' as const, ts: n.created_at, data: n })),
      ...clientTasks.map((t) => ({ type: 'task' as const, ts: t.completed_at, data: t })),
      ...clientMessages.map((m) => ({ type: 'message' as const, ts: m.created_at, data: m })),
    ].sort((a, b) => b.ts.localeCompare(a.ts))
    const { start: periodStart, end: periodEnd } = periodBounds(timelinePeriod)
    const timeline = fullTimeline.filter((item) => {
      if (timelineType !== 'all' && item.type !== timelineType) return false
      if (periodStart && item.ts < periodStart) return false
      if (periodEnd && item.ts >= periodEnd) return false
      return true
    })

    return (
      <div>
        <button className="flex items-center gap-1 text-sm font-medium text-sage hover:text-ink transition-colors mb-5" onClick={() => setSelectedId(null)}>
          <span aria-hidden>←</span> Clients
        </button>

        <div className="flex flex-col gap-5">
        {editing ? (
          <ClientForm
            title={`Edit ${selected.name}`}
            form={editForm}
            setForm={setEditForm}
            onCancel={() => setEditing(false)}
            onSave={() => {
              const isHourly = editForm.billing_mode === 'hourly'
              updateClient(selected.id, {
                name: editForm.name,
                business: editForm.business,
                platform: editForm.platform || null,
                service: editForm.service,
                notes: editForm.notes,
                tone: editForm.tone,
                talking_points: editForm.talking_points,
                cadence_days: editForm.cadence_days,
                stage: editForm.stage,
                billing_mode: editForm.billing_mode || 'retainer',
                retainer_cents: isHourly ? 0 : dollarsToCents((editForm.retainer as string) || '0'),
                retainer_hours: isHourly ? null : (editForm.retainer_hours ? Number(editForm.retainer_hours) : null),
                hourly_rate_cents: isHourly ? dollarsToCents((editForm.hourly_rate as string) || '0') : 0,
                billing_day: Math.min(31, Math.max(1, Number(editForm.billing_day) || 1)),
                contract_ends: editForm.contract_ends || null,
                contact_email: editForm.contact_email || null,
                contact_domain: editForm.contact_domain || null,
                primary_contact_id: editForm.owner || null,
              })
            }}
            members={members}
            currencySign={currencySign}
          />
        ) : (
          <div className="rounded-lg border border-ink/10 bg-white p-4">
            <div className="flex gap-4 items-start">
              <div className="relative shrink-0">
                <Avatar name={selected.name} index={clients.indexOf(selected)} size={48} />
                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white" style={{ background: dotColor }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-bold text-lg">{selected.name}</div>
                  <Tooltip content={STAGE_TOOLTIP}>
                    <span
                      className="text-xs font-semibold rounded-full px-2 py-0.5"
                      style={{ color: sColor, background: `${sColor}22` }}
                    >
                      {stageLabel(stage)}
                    </span>
                  </Tooltip>
                  {!isChurned && (
                    <Tooltip content={HEALTH_TOOLTIP}>
                      <span
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded border px-2 py-0.5"
                        style={{ color: dotColor, borderColor: `${dotColor}55` }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                        {HEALTH_LABEL[health]}
                      </span>
                    </Tooltip>
                  )}
                  {selected.awaiting_reply && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
                      <ClockIcon size={12} /> Awaiting reply
                    </span>
                  )}
                  {selected.primary_contact_id && (
                    <span className="text-xs text-sage bg-ink/5 rounded-full px-2 py-0.5">Owner: {memberName(memberById(selected.primary_contact_id))}</span>
                  )}
                </div>
                <div className="text-sm text-sage mt-2 flex gap-2 flex-wrap items-center">
                  {selected.business && <span>{selected.business}</span>}
                  {selected.platform && <span className="bg-ink/5 rounded px-1.5">{selected.platform}</span>}
                  {selected.service && <span>{selected.service}</span>}
                  {selected.cadence_days && <span className="text-sage">{cadenceLabel(selected.cadence_days)}</span>}
                </div>
                {selected.last_contacted && <div className="text-xs text-sage mt-1">Last contacted: {formatDate(selected.last_contacted)}</div>}
                {clientHealthTrend(selected.id).length > 1 && (
                  <div className="flex items-center gap-0.5 mt-1.5">
                    {clientHealthTrend(selected.id).map((s) => (
                      <div
                        key={s.snapshot_date}
                        className="h-2 w-2 rounded-full"
                        style={{ background: HEALTH_COLOR[s.health] }}
                        title={`${formatDate(s.snapshot_date)}: ${HEALTH_LABEL[s.health]}`}
                      />
                    ))}
                    <span className="text-xs text-sage ml-1">health, last {clientHealthTrend(selected.id).length}d</span>
                  </div>
                )}
                <div className="flex gap-3 mt-1 flex-wrap">
                  {!!selected.retainer_cents && <span className="text-xs text-green font-semibold">{currencySign}{centsToDollars(selected.retainer_cents).toLocaleString()}/mo</span>}
                  {selected.billing_mode !== 'hourly' && !!selected.retainer_cents && (
                    <span className="text-xs text-sage">
                      renews in {daysUntilRenewal(selected.billing_day || 1)} day{daysUntilRenewal(selected.billing_day || 1) === 1 ? '' : 's'}
                    </span>
                  )}
                  {selected.billing_mode === 'hourly' && !!selected.hourly_rate_cents && (
                    <span className="text-xs text-green font-semibold">{currencySign}{centsToDollars(selected.hourly_rate_cents).toLocaleString()}/hr</span>
                  )}
                  {selected.contract_ends && <span className="text-xs text-sage">Contract ends: {formatDate(selected.contract_ends)}</span>}
                  {clientHoursSeconds(selected.id) > 0 && (
                    <Link href="/time" className="text-xs text-sage underline">
                      {(clientHoursSeconds(selected.id) / 3600).toFixed(1)}h logged
                    </Link>
                  )}
                  {clientBurn[selected.id] && (
                    <Tooltip
                      content={`${clientBurn[selected.id].hoursLogged.toFixed(1)}h of ~${clientBurn[selected.id].hoursBudget.toFixed(1)}h supported by the retainer this billing cycle.`}
                    >
                      <span
                        className="text-xs font-semibold rounded-full px-2 py-0.5"
                        style={{
                          color: clientBurn[selected.id].status === 'ok' ? '#5d6b5c' : clientBurn[selected.id].status === 'warn' ? '#cc9a3c' : '#e05070',
                          background:
                            clientBurn[selected.id].status === 'ok'
                              ? '#5d6b5c18'
                              : clientBurn[selected.id].status === 'warn'
                                ? '#cc9a3c18'
                                : '#e0507018',
                        }}
                      >
                        {Math.round(clientBurn[selected.id].percent)}% burn
                      </span>
                    </Tooltip>
                  )}
                </div>
                {selected.notes && <div className="text-xs text-sage mt-2 italic">{selected.notes}</div>}
              </div>
              {canEdit && (
                <div className="flex gap-1.5 shrink-0 items-center">
                  <button
                    className={`text-xs rounded-lg px-2.5 py-1.5 font-medium border shadow-sm transition-colors inline-flex items-center gap-1 ${
                      isChurned ? 'border-green/40 text-green hover:bg-green/10' : 'border-red-600/30 text-red-600 hover:bg-red-600/10'
                    }`}
                    onClick={() => updateClient(selected.id, { stage: isChurned ? 'Active' : 'Churned', status: isChurned ? 'active' : 'inactive' })}
                  >
                    {isChurned ? <><PlayIcon size={11} /> Activate</> : <><PauseIcon size={11} /> Pause</>}
                  </button>
                  <button
                    className="text-xs rounded-lg px-2.5 py-1.5 font-medium border border-ink/15 text-ink hover:bg-sand shadow-sm inline-flex items-center gap-1"
                    onClick={() => setShowUpdateModal(true)}
                  >
                    <SparkleIcon size={11} /> Draft update
                  </button>
                  <button
                    className="text-xs rounded-lg px-2.5 py-1.5 font-medium text-white shadow-sm bg-accent"
                    onClick={() => {
                      setEditing(true)
                      setEditForm({
                        name: selected.name,
                        business: selected.business || '',
                        platform: selected.platform || '',
                        service: selected.service || '',
                        notes: selected.notes || '',
                        tone: selected.tone || 'Friendly',
                        talking_points: selected.talking_points || '',
                        cadence_days: selected.cadence_days || 7,
                        stage,
                        billing_mode: selected.billing_mode || 'retainer',
                        retainer: selected.retainer_cents ? centsToDollars(selected.retainer_cents) : '',
                        retainer_hours: selected.retainer_hours ?? '',
                        hourly_rate: selected.hourly_rate_cents ? centsToDollars(selected.hourly_rate_cents) : '',
                        billing_day: selected.billing_day || 1,
                        contract_ends: selected.contract_ends || '',
                        contact_email: selected.contact_email || '',
                        contact_domain: selected.contact_domain || '',
                        owner: selected.primary_contact_id || '',
                      })
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="text-xs text-sage/60 hover:text-red-600 px-1.5 ml-1"
                    onClick={() => deleteClient(selected.id)}
                    title="Delete client"
                  >
                    <XIcon size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <div className="text-xs font-semibold tracking-wide text-sage mb-3">Quick note</div>
          <textarea
            className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm min-h-[70px] disabled:opacity-60"
            placeholder="Jot anything down…"
            value={selected.quick_note || ''}
            disabled={!canEdit}
            onChange={(e) => {
              const val = e.target.value
              setClients((prev) => prev.map((c) => (c.id === selected.id ? { ...c, quick_note: val } : c)))
            }}
            onBlur={(e) => canEdit && updateClient(selected.id, { quick_note: e.target.value })}
          />
        </div>

        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <ClientFiles supabase={supabase} orgId={orgId} clientId={selected.id} canEdit={canEdit} />
        </div>

        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold tracking-wide text-sage">Activity</div>
            <div className="flex gap-2 text-xs text-sage">
              <span>{clientNotes.length} note{clientNotes.length === 1 ? '' : 's'}</span>
              <span>·</span>
              <span>{clientTasks.length} task{clientTasks.length === 1 ? '' : 's'}</span>
              <span>·</span>
              <span>{clientMessages.length} message{clientMessages.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="flex gap-2 mb-4 items-end">
            <textarea
              className="flex-1 rounded-md border border-ink/10 bg-white px-3 py-2 text-sm min-h-[44px]"
              placeholder="Add a note…"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
            />
            <button className="rounded bg-accent text-white shadow-md px-3 py-2 text-sm font-medium shrink-0" onClick={() => addNote(selected.id, noteInput)}>
              Add
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <CustomSelect
              value={timelineType}
              onChange={(v) => setTimelineType(v as 'all' | 'note' | 'task' | 'message')}
              options={[
                { value: 'all', label: 'All activity' },
                { value: 'note', label: 'Notes' },
                { value: 'task', label: 'Completed tasks' },
                { value: 'message', label: 'AI messages' },
              ]}
              className="w-40"
            />
            <PeriodSelector value={timelinePeriod} onChange={setTimelinePeriod} layoutId="client-timeline-period" />
          </div>
          {timeline.length === 0 && (
            <div className="text-sm text-sage py-3">{fullTimeline.length === 0 ? 'No activity yet.' : 'No activity matches these filters.'}</div>
          )}
          {timeline.length > 0 && (
            <div className="flex flex-col max-h-[420px] overflow-y-auto pr-1 border-t border-ink/5 pt-3">
              {timeline.map((item, idx) => (
                <div key={idx} className="flex gap-3 pb-4">
                  <div className="flex flex-col items-center shrink-0">
                    <div className="h-7 w-7 rounded-full bg-white border border-ink/10 flex items-center justify-center text-sage">
                      {item.type === 'note' ? <PencilIcon size={13} /> : item.type === 'message' ? <MessageCircleIcon size={13} /> : <CheckIcon size={13} />}
                    </div>
                    {idx < timeline.length - 1 && <div className="w-px flex-1 bg-ink/5 mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    {item.type === 'note' && (
                      <div>
                        <div className="text-sm whitespace-pre-wrap">{item.data.text}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-sage">
                            {formatNoteTime(item.data.created_at)}
                            {item.data.author_id && ` · ${memberName(memberById(item.data.author_id))}`}
                          </span>
                          <button className="text-red-600" onClick={() => deleteNote(item.data.id)}>
                            <XIcon size={11} />
                          </button>
                        </div>
                      </div>
                    )}
                    {item.type === 'message' && (
                      <div className="rounded-md bg-sand px-3 py-2">
                        <div className="text-xs text-sage mb-1 font-semibold">
                          Message sent · {formatDate(item.data.created_at.slice(0, 10))}
                          {item.data.generated_by && ` · ${memberName(memberById(item.data.generated_by))}`}
                        </div>
                        <div className="text-sm">{item.data.message}</div>
                      </div>
                    )}
                    {item.type === 'task' && (
                      <div>
                        <div className="text-sm text-sage flex items-center gap-1">
                          <CheckIcon size={12} className="text-green" />
                          {item.data.title}
                        </div>
                        <div className="text-xs text-sage mt-0.5">
                          {formatNoteTime(item.data.completed_at)}
                          {' · '}
                          {item.data.assigned_to ? `Assigned to ${memberName(memberById(item.data.assigned_to))}` : 'Unassigned'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
        {showUpdateModal && (
          <ClientUpdateModal
            supabase={supabase}
            orgId={orgId}
            userId={userId}
            clientId={selected.id}
            onSaved={(note) => setNotes((prev) => [note, ...prev])}
            onClose={() => setShowUpdateModal(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      {/* The tour spotlights this whole region: it holds the "+ New client" button and, once open,
          the add form - so the form itself lights up (bright) while the user fills it in. */}
      <div data-tour="clients-add-region">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold">
            Clients <span className="text-sm font-normal text-sage">({clients.length})</span>
          </h1>
          {canEdit && !showAdd && (
            <Button variant="primary" data-tour="add-client-button" onClick={() => setShowAdd(true)}>
              + New client
            </Button>
          )}
        </div>

        {canEdit && showAdd && (
          <ClientForm title="New client" form={form} setForm={setForm} onCancel={() => setShowAdd(false)} onSave={addClient} members={members} currencySign={currencySign} />
        )}
      </div>

      {clients.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            className="flex-1 min-w-[10rem] rounded-full border border-ink/10 bg-white px-3 py-1.5 text-sm"
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <CustomSelect
            value={stageFilter}
            onChange={setStageFilter}
            options={[{ value: '', label: 'All stages' }, ...STAGES.map((s) => ({ value: s, label: stageLabel(s) }))]}
            className="w-36"
          />
        </div>
      )}

      {clients.length === 0 && !showAdd && <div className="text-sm text-sage py-6">No clients yet.</div>}
      {(() => {
        const q = search.trim().toLowerCase()
        const filteredClients = clients.filter((c) => {
          if (stageFilter && getStage(c) !== stageFilter) return false
          if (q && !c.name.toLowerCase().includes(q) && !(c.business ?? '').toLowerCase().includes(q)) return false
          return true
        })
        if (filteredClients.length === 0 && clients.length > 0) {
          return <div className="text-sm text-sage py-6">No clients match your search.</div>
        }
        return filteredClients.map((c) => {
        const i = clients.indexOf(c)
        const stage = getStage(c)
        const health = clientHealthKey(c, today)
        const dotColor = HEALTH_COLOR[health]
        return (
          <div key={c.id} className="flex items-center gap-3 py-3 border-b border-ink/10 cursor-pointer" onClick={() => setSelectedId(c.id)}>
            <div className="relative shrink-0">
              <Avatar name={c.name} index={i} size={38} />
              <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ background: dotColor }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-medium text-sm">{c.name}</div>
                <Tooltip content={STAGE_TOOLTIP}>
                  <span
                    className="text-xs font-semibold rounded-full px-1.5 py-0.5"
                    style={{ color: stageColor(stage), background: `${stageColor(stage)}18` }}
                  >
                    {stageLabel(stage)}
                  </span>
                </Tooltip>
                {stage !== 'Churned' && (
                  <Tooltip content={HEALTH_TOOLTIP}>
                    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: dotColor }}>
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                      {HEALTH_LABEL[health]}
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="text-xs text-sage mt-1.5 flex gap-2 flex-wrap items-center">
                {c.business && <span>{c.business}</span>}
                {c.platform && <span className="bg-ink/5 rounded px-1.5">{c.platform}</span>}
                {c.last_contacted && <span>Last: {formatDate(c.last_contacted)}</span>}
                {c.primary_contact_id && <span>{memberName(memberById(c.primary_contact_id))}</span>}
                {clientBurn[c.id] && clientBurn[c.id].status !== 'ok' && (
                  <span
                    className="font-semibold rounded-full px-1.5 py-0.5"
                    style={{
                      color: clientBurn[c.id].status === 'warn' ? '#cc9a3c' : '#e05070',
                      background: clientBurn[c.id].status === 'warn' ? '#cc9a3c18' : '#e0507018',
                    }}
                  >
                    {Math.round(clientBurn[c.id].percent)}% burn
                  </span>
                )}
              </div>
            </div>
            <span className="text-sage/70">›</span>
          </div>
        )
        })
      })()}
    </div>
  )
}

function Avatar({ name, index, size = 36 }: { name: string; index: number; size?: number }) {
  return (
    <div
      className="flex items-center justify-center font-bold text-white shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: AVATAR_COLORS[Math.abs(index) % AVATAR_COLORS.length],
        fontSize: size * 0.36,
      }}
    >
      {getInitials(name)}
    </div>
  )
}

function ClientForm({
  title,
  form,
  setForm,
  onCancel,
  onSave,
  members,
  currencySign,
}: {
  title: string
  form: Record<string, unknown>
  setForm: (f: (prev: Record<string, unknown>) => Record<string, unknown>) => void
  onCancel: () => void
  onSave: () => void
  members: Member[]
  currencySign: string
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4 mb-5">
      <div className="text-sm font-semibold mb-4">{title}</div>

      <div className="text-xs font-semibold tracking-wide text-sage mb-2">Basics</div>
      <label className="block text-xs text-sage mb-1">Name *</label>
      <input
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm mb-3"
        value={(form.name as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        autoFocus
      />
      <label className="block text-xs text-sage mb-1">Business / Brand</label>
      <input
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm mb-3"
        value={(form.business as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <div>
          <label className="block text-xs text-sage mb-1">Communication channel</label>
          <CustomSelect
            value={(form.platform as string) || ''}
            onChange={(v) => setForm((f) => ({ ...f, platform: v }))}
            placeholder="How you talk to them…"
            options={PLATFORMS.map((p) => ({ value: p, label: p }))}
          />
        </div>
        <div>
          <label className="block text-xs text-sage mb-1">Service / plan</label>
          <input
            className="w-full rounded border border-ink/10 bg-white px-2 py-2 text-sm"
            placeholder="e.g. SEO retainer"
            value={(form.service as string) || ''}
            onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
          />
        </div>
      </div>
      <label className="block text-xs text-sage mb-1">Contact email</label>
      <input
        type="email"
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm mb-3"
        placeholder="jane@acme.com"
        value={(form.contact_email as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
      />
      <label className="block text-xs text-sage mb-1">Contact domain</label>
      <input
        className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-4"
        placeholder="acme.com"
        value={(form.contact_domain as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, contact_domain: e.target.value }))}
      />

      <div className="text-xs font-semibold tracking-wide text-sage mb-2 pt-3 border-t border-ink/5">AI check-in config</div>
      <div className="text-xs text-sage/70 mb-3 -mt-1">Feeds the AI-drafted check-in messages on your Dashboard.</div>
      <label className="block text-xs text-sage mb-1">Check-in cadence</label>
      <div className="mb-4">
        <CustomSelect
          value={String((form.cadence_days as number) || 7)}
          onChange={(v) => setForm((f) => ({ ...f, cadence_days: Number(v) }))}
          options={[
            { value: '1', label: 'Daily' },
            { value: '2', label: 'Every 2 days' },
            { value: '7', label: 'Weekly' },
            { value: '14', label: 'Bi-weekly' },
            { value: '30', label: 'Monthly' },
          ]}
        />
      </div>
      <label className="block text-xs text-sage mb-1">Message tone</label>
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {TONES.map((t) => (
          <button
            key={t}
            onClick={() => setForm((f) => ({ ...f, tone: t }))}
            className={`px-3 py-1 rounded text-xs border ${form.tone === t ? 'bg-accent text-white border-accent' : 'border-ink/15 text-sage'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <label className="block text-xs text-sage mb-1">Background context</label>
      <div className="text-xs text-sage/70 mb-1">General background the AI should know about this client - history, quirks, how they like to be talked to.</div>
      <textarea
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm mb-3"
        value={(form.notes as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
      />
      <label className="block text-xs text-sage mb-1">Talking points</label>
      <div className="text-xs text-sage/70 mb-1">Specific things to make sure get mentioned (optional) - stays set until you clear it.</div>
      <textarea
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm mb-3"
        value={(form.talking_points as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, talking_points: e.target.value }))}
      />

      <div className="text-xs font-semibold tracking-wide text-sage mb-2 pt-3 border-t border-ink/5">Pipeline &amp; billing</div>
      <label className="block text-xs text-sage mb-1">Pipeline stage</label>
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {STAGES.map((st) => (
          <button
            key={st}
            onClick={() => setForm((f) => ({ ...f, stage: st }))}
            className={`px-3 py-1 rounded text-xs border`}
            style={
              form.stage === st
                ? { color: stageColor(st), background: `${stageColor(st)}22`, borderColor: stageColor(st) }
                : { borderColor: 'rgba(255,255,255,0.15)', color: '#a3a3a3' }
            }
          >
            {stageLabel(st)}
          </button>
        ))}
      </div>
      <label className="block text-xs text-sage mb-1">Billing</label>
      <div className="flex gap-1.5 mb-3">
        {(['retainer', 'hourly'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() =>
              setForm((f) => ({
                ...f,
                billing_mode: mode,
                // mutually exclusive - switching modes clears the other field's draft value so
                // a stale number can't get saved if the user flips back without touching it
                ...(mode === 'hourly' ? { retainer: '' } : { hourly_rate: '' }),
              }))
            }
            className={`px-3 py-1 rounded text-xs border ${
              (form.billing_mode || 'retainer') === mode ? 'bg-accent text-white border-accent' : 'border-ink/15 text-sage'
            }`}
          >
            {mode === 'retainer' ? 'Retainer' : 'Hourly'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        {form.billing_mode === 'hourly' ? (
          <div>
            <label className="block text-xs text-sage mb-1">Hourly rate ({currencySign}/hr)</label>
            <input
              type="number"
              className="w-full rounded border border-ink/10 bg-white px-2 py-2 text-sm"
              value={(form.hourly_rate as string) || ''}
              onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))}
            />
          </div>
        ) : (
          <div>
            <label className="block text-xs text-sage mb-1">Monthly retainer ({currencySign})</label>
            <input
              type="number"
              className="w-full rounded border border-ink/10 bg-white px-2 py-2 text-sm"
              value={(form.retainer as string) || ''}
              onChange={(e) => setForm((f) => ({ ...f, retainer: e.target.value }))}
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-sage mb-1">Contract ends</label>
          <DatePicker
            value={(form.contract_ends as string) || ''}
            onChange={(v) => setForm((f) => ({ ...f, contract_ends: v }))}
            placeholder="No end date"
          />
        </div>
      </div>
      {form.billing_mode !== 'hourly' && (
        <div className="mb-3">
          <label className="block text-xs text-sage mb-1">Billing day of month</label>
          <input
            type="number"
            min={1}
            max={31}
            className="w-24 rounded border border-ink/10 bg-white px-2 py-2 text-sm"
            value={(form.billing_day as number) || 1}
            onChange={(e) => setForm((f) => ({ ...f, billing_day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) }))}
          />
          <div className="text-xs text-sage/70 mt-1">
            Day the retainer renews - drives how &quot;this month&quot; is prorated in Reports and Revenue. For a day that
            doesn&apos;t exist in a given month (e.g. 31 in April), the last day of that month is used instead.
          </div>
        </div>
      )}
      {form.billing_mode !== 'hourly' && (
        <div className="mb-3">
          <label className="block text-xs text-sage mb-1">Included team hours / month</label>
          <input
            type="number"
            min={0}
            className="w-24 rounded border border-ink/10 bg-white px-2 py-2 text-sm"
            value={(form.retainer_hours as string) || ''}
            onChange={(e) => setForm((f) => ({ ...f, retainer_hours: e.target.value }))}
          />
          <div className="text-xs text-sage/70 mt-1">
            All team members combined. Leave blank to derive from the retainer and your target hourly rate
            (Settings → General).
          </div>
        </div>
      )}
      <label className="block text-xs text-sage mb-1">Owner</label>
      <div className="text-xs text-sage/70 mb-1">Who&apos;s the point of contact - check-ins assign to them, and replies default to their connected mailbox</div>
      <div className="mb-4">
        <CustomSelect
          value={(form.owner as string) || ''}
          onChange={(v) => setForm((f) => ({ ...f, owner: v }))}
          placeholder="Unassigned"
          options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.user_id, label: memberName(m) }))]}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button data-tour-advance="save-client" className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  )
}
