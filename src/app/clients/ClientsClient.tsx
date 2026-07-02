'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  AVATAR_COLORS,
  PLATFORMS,
  STAGES,
  TONES,
  cadenceLabel,
  centsToDollars,
  dollarsToCents,
  formatDate,
  formatNoteTime,
  getHealthScore,
  getInitials,
  getStage,
  stageColor,
  todayKey,
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
  contract_ends: string | null
  last_contacted: string | null
  quick_note: string | null
  awaiting_reply: boolean
  contact_email: string | null
  contact_domain: string | null
}
type Note = { id: string; client_id: string; text: string; created_at: string }
type InboxMessage = { id: string; thread_id: string; direction: 'in' | 'out'; sender: string | null; body: string | null; sent_at: string }
type CompletedTask = { id: string; client_id: string | null; title: string; completed_at: string }
type AiMessage = { id: string; client_id: string | null; message: string | null; created_at: string }

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
  retainer: '',
  contract_ends: '',
  contact_email: '',
  contact_domain: '',
}

export default function ClientsClient({
  orgId,
  userId,
  initialClients,
  initialNotes,
  completedTasks,
  aiMessages,
  timeEntries,
}: {
  orgId: string
  userId: string
  initialClients: Client[]
  initialNotes: Note[]
  completedTasks: CompletedTask[]
  aiMessages: AiMessage[]
  timeEntries: { client_id: string | null; duration_seconds: number | null }[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [notes, setNotes] = useState<Note[]>(initialNotes)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string, unknown>>(emptyForm)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, unknown>>({})
  const [noteInput, setNoteInput] = useState('')
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([])
  const [loadingInbox, setLoadingInbox] = useState(false)
  const [syncingInbox, setSyncingInbox] = useState(false)
  const [inboxError, setInboxError] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [sendingReply, setSendingReply] = useState(false)

  const today = todayKey()
  const selected = clients.find((c) => c.id === selectedId) || null

  function clientHoursSeconds(clientId: string) {
    return timeEntries.filter((e) => e.client_id === clientId).reduce((s, e) => s + (e.duration_seconds || 0), 0)
  }

  async function loadInbox(clientId: string) {
    setLoadingInbox(true)
    const { data: threads } = await supabase.from('inbox_threads').select('id').eq('client_id', clientId)
    const threadIds = (threads || []).map((t) => t.id)
    if (threadIds.length) {
      const { data: msgs } = await supabase
        .from('inbox_messages')
        .select('*')
        .in('thread_id', threadIds)
        .order('sent_at', { ascending: false })
        .limit(20)
      setInboxMessages((msgs || []) as InboxMessage[])
    } else {
      setInboxMessages([])
    }
    setLoadingInbox(false)
  }

  useEffect(() => {
    if (selectedId) loadInbox(selectedId)
    setInboxError(null)
    setReplyBody('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  async function syncInbox() {
    setSyncingInbox(true)
    setInboxError(null)
    const res = await fetch('/api/integrations/gmail/sync', { method: 'POST' })
    const body = await res.json()
    if (!res.ok) setInboxError(body.error ?? 'Sync failed')
    else if (selectedId) await loadInbox(selectedId)
    setSyncingInbox(false)
  }

  async function sendReply() {
    if (!selected || !replyBody.trim()) return
    setSendingReply(true)
    setInboxError(null)
    const res = await fetch('/api/integrations/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: selected.id, subject: `Re: ${selected.name}`, body: replyBody }),
    })
    const body = await res.json()
    if (!res.ok) setInboxError(body.error ?? 'Send failed')
    else {
      setReplyBody('')
      await loadInbox(selected.id)
    }
    setSendingReply(false)
  }

  async function addClient() {
    const name = (form.name as string) || ''
    if (!name.trim()) return
    const { data } = await supabase
      .from('clients')
      .insert({
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
        retainer_cents: dollarsToCents((form.retainer as string) || '0'),
        contract_ends: (form.contract_ends as string) || null,
        contact_email: (form.contact_email as string) || null,
        contact_domain: (form.contact_domain as string) || null,
        added_date: today,
      })
      .select()
      .single()
    if (data) setClients((prev) => [...prev, data as Client].sort((a, b) => a.name.localeCompare(b.name)))
    setForm(emptyForm)
    setShowAdd(false)
  }

  async function updateClient(id: string, fields: Record<string, unknown>) {
    const { data } = await supabase.from('clients').update(fields).eq('id', id).select().single()
    if (data) setClients((prev) => prev.map((c) => (c.id === id ? (data as Client) : c)))
    setEditing(false)
  }

  async function deleteClient(id: string) {
    if (!window.confirm('Delete this client? This will also remove their tasks.')) return
    await supabase.from('clients').delete().eq('id', id)
    await supabase.from('tasks').delete().eq('client_id', id)
    setClients((prev) => prev.filter((c) => c.id !== id))
    setSelectedId(null)
  }

  async function addNote(clientId: string, text: string) {
    if (!text.trim()) return
    const { data } = await supabase
      .from('client_notes')
      .insert({ org_id: orgId, client_id: clientId, author_id: userId, text: text.trim() })
      .select()
      .single()
    if (data) setNotes((prev) => [data as Note, ...prev])
    setNoteInput('')
  }
  async function deleteNote(id: string) {
    await supabase.from('client_notes').delete().eq('id', id)
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  if (selected) {
    const stage = getStage(selected)
    const isChurned = stage === 'Churned'
    const hs = isChurned ? 'grey' : getHealthScore(selected.last_contacted, today, selected.cadence_days || 7)
    const dotColor = isChurned ? '#6060a0' : hs === 'green' ? '#2db87a' : hs === 'amber' ? '#cc9a3c' : '#e05070'
    const sColor = stageColor(stage)
    const clientNotes = notes.filter((n) => n.client_id === selected.id)
    const clientTasks = completedTasks.filter((t) => t.client_id === selected.id)
    const clientMessages = aiMessages.filter((m) => m.client_id === selected.id && m.message)
    const timeline = [
      ...clientNotes.map((n) => ({ type: 'note' as const, ts: n.created_at, data: n })),
      ...clientTasks.map((t) => ({ type: 'task' as const, ts: t.completed_at, data: t })),
      ...clientMessages.map((m) => ({ type: 'message' as const, ts: m.created_at, data: m })),
    ].sort((a, b) => b.ts.localeCompare(a.ts))

    return (
      <div>
        <button className="text-sm text-neutral-400 mb-5" onClick={() => setSelectedId(null)}>
          ← Clients
        </button>

        {editing ? (
          <ClientForm
            title={`Edit ${selected.name}`}
            form={editForm}
            setForm={setEditForm}
            onCancel={() => setEditing(false)}
            onSave={() =>
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
                retainer_cents: dollarsToCents((editForm.retainer as string) || '0'),
                contract_ends: editForm.contract_ends || null,
                contact_email: editForm.contact_email || null,
                contact_domain: editForm.contact_domain || null,
              })
            }
          />
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 mb-5">
            <div className="flex gap-4 items-start">
              <div className="relative shrink-0">
                <Avatar name={selected.name} index={clients.indexOf(selected)} size={48} />
                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-neutral-900" style={{ background: dotColor }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-bold text-lg">{selected.name}</div>
                  <span className="text-xs font-semibold rounded-full px-2 py-0.5" style={{ color: sColor, background: `${sColor}22` }}>
                    {stage}
                  </span>
                  {selected.awaiting_reply && <span className="text-xs text-amber-400 font-medium">⏳ Awaiting reply</span>}
                </div>
                <div className="text-sm text-neutral-400 mt-1 flex gap-2 flex-wrap items-center">
                  {selected.business && <span>{selected.business}</span>}
                  {selected.platform && <span className="bg-white/10 rounded px-1.5">{selected.platform}</span>}
                  {selected.service && <span>{selected.service}</span>}
                  {selected.cadence_days && <span className="text-neutral-500">{cadenceLabel(selected.cadence_days)}</span>}
                </div>
                {selected.last_contacted && <div className="text-xs text-neutral-500 mt-1">Last contacted: {formatDate(selected.last_contacted)}</div>}
                <div className="flex gap-3 mt-1 flex-wrap">
                  {!!selected.retainer_cents && <span className="text-xs text-emerald-400 font-semibold">${centsToDollars(selected.retainer_cents).toLocaleString()}/mo</span>}
                  {selected.contract_ends && <span className="text-xs text-neutral-500">Contract ends: {formatDate(selected.contract_ends)}</span>}
                  {clientHoursSeconds(selected.id) > 0 && (
                    <Link href="/time" className="text-xs text-neutral-500 underline">
                      {(clientHoursSeconds(selected.id) / 3600).toFixed(1)}h logged
                    </Link>
                  )}
                </div>
                {selected.notes && <div className="text-xs text-neutral-400 mt-2 italic">{selected.notes}</div>}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  className="text-xs rounded border border-white/10 px-2 py-1"
                  onClick={() => updateClient(selected.id, { stage: isChurned ? 'Active' : 'Churned', status: isChurned ? 'active' : 'inactive' })}
                >
                  {isChurned ? '▶ Activate' : '⏸ Churn'}
                </button>
                <button
                  className="text-xs rounded border border-white/10 px-2 py-1"
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
                      retainer: selected.retainer_cents ? centsToDollars(selected.retainer_cents) : '',
                      contract_ends: selected.contract_ends || '',
                      contact_email: selected.contact_email || '',
                      contact_domain: selected.contact_domain || '',
                    })
                  }}
                >
                  Edit
                </button>
                <button className="text-xs text-red-400 px-1" onClick={() => deleteClient(selected.id)}>
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Quick note</div>
          <textarea
            className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm min-h-[70px]"
            placeholder="Jot anything down…"
            value={selected.quick_note || ''}
            onChange={(e) => {
              const val = e.target.value
              setClients((prev) => prev.map((c) => (c.id === selected.id ? { ...c, quick_note: val } : c)))
            }}
            onBlur={(e) => updateClient(selected.id, { quick_note: e.target.value })}
          />
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Inbox</div>
            <button className="text-xs rounded border border-white/10 px-2 py-1" onClick={syncInbox} disabled={syncingInbox}>
              {syncingInbox ? 'Syncing…' : '↺ Sync inbox'}
            </button>
          </div>
          {inboxError && <div className="text-xs text-red-400 mb-2">{inboxError}</div>}
          {loadingInbox && <div className="text-sm text-neutral-500 py-2">Loading…</div>}
          {!loadingInbox && inboxMessages.length === 0 && (
            <div className="text-sm text-neutral-500 py-2">
              No matched emails yet. Connect Gmail in Settings, add this client&apos;s contact email/domain, then sync.
            </div>
          )}
          {inboxMessages.map((m) => (
            <div key={m.id} className={`rounded-md px-3 py-2 mb-2 text-sm ${m.direction === 'out' ? 'bg-white/10 ml-6' : 'bg-white/5 mr-6'}`}>
              <div className="text-xs text-neutral-500 mb-1">
                {m.direction === 'out' ? 'You' : m.sender} · {formatNoteTime(m.sent_at)}
              </div>
              <div className="whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
          <div className="flex gap-2 items-end mt-2">
            <textarea
              className="flex-1 rounded border border-white/10 bg-black/30 px-3 py-2 text-sm min-h-[44px]"
              placeholder={selected.contact_email ? `Message ${selected.name}…` : 'Add a contact email to this client first'}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              disabled={!selected.contact_email}
            />
            <button
              className="rounded bg-white text-black px-3 py-2 text-sm font-medium shrink-0 disabled:opacity-40"
              onClick={sendReply}
              disabled={!selected.contact_email || !replyBody.trim() || sendingReply}
            >
              {sendingReply ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>

        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Activity</div>
        <div className="flex gap-2 mb-4 items-end">
          <textarea
            className="flex-1 rounded border border-white/10 bg-black/30 px-3 py-2 text-sm min-h-[44px]"
            placeholder="Add a note…"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
          />
          <button className="rounded bg-white text-black px-3 py-2 text-sm font-medium shrink-0" onClick={() => addNote(selected.id, noteInput)}>
            Add
          </button>
        </div>
        {timeline.length === 0 && <div className="text-sm text-neutral-500 py-3">No activity yet.</div>}
        <div className="flex flex-col">
          {timeline.map((item, idx) => (
            <div key={idx} className="flex gap-3 pb-4">
              <div className="flex flex-col items-center shrink-0">
                <div className="h-7 w-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm">
                  {item.type === 'note' ? '📝' : item.type === 'message' ? '💬' : '✓'}
                </div>
                {idx < timeline.length - 1 && <div className="w-px flex-1 bg-white/10 mt-1" />}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                {item.type === 'note' && (
                  <div>
                    <div className="text-sm whitespace-pre-wrap">{item.data.text}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-neutral-500">{formatNoteTime(item.data.created_at)}</span>
                      <button className="text-xs text-red-400" onClick={() => deleteNote(item.data.id)}>
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                {item.type === 'message' && (
                  <div className="rounded-md bg-white/5 px-3 py-2">
                    <div className="text-xs text-neutral-500 mb-1 font-semibold">Message sent · {formatDate(item.data.created_at.slice(0, 10))}</div>
                    <div className="text-sm">{item.data.message}</div>
                  </div>
                )}
                {item.type === 'task' && (
                  <div>
                    <div className="text-sm text-neutral-400">
                      <span className="text-emerald-400 mr-1">✓</span>
                      {item.data.title}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">{formatNoteTime(item.data.completed_at)}</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold">
          Clients <span className="text-sm font-normal text-neutral-500">({clients.length})</span>
        </h1>
        {!showAdd && (
          <button className="rounded-md bg-white text-black px-3 py-1.5 text-sm font-medium" onClick={() => setShowAdd(true)}>
            + New client
          </button>
        )}
      </div>

      {showAdd && <ClientForm title="New client" form={form} setForm={setForm} onCancel={() => setShowAdd(false)} onSave={addClient} />}

      {clients.length === 0 && !showAdd && <div className="text-sm text-neutral-500 py-6">No clients yet.</div>}
      {clients.map((c, i) => {
        const stage = getStage(c)
        const isChurned = stage === 'Churned'
        const hs = isChurned ? 'grey' : getHealthScore(c.last_contacted, today, c.cadence_days || 7)
        const dotColor = isChurned ? '#6060a0' : hs === 'green' ? '#2db87a' : hs === 'amber' ? '#cc9a3c' : '#e05070'
        return (
          <div key={c.id} className="flex items-center gap-3 py-3 border-b border-white/10 cursor-pointer" onClick={() => setSelectedId(c.id)}>
            <div className="relative shrink-0">
              <Avatar name={c.name} index={i} size={38} />
              <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-neutral-950" style={{ background: dotColor }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-medium text-sm">{c.name}</div>
                <span className="text-[10px] font-semibold" style={{ color: stageColor(stage) }}>
                  {stage}
                </span>
              </div>
              <div className="text-xs text-neutral-500 mt-0.5 flex gap-2 flex-wrap">
                {c.business && <span>{c.business}</span>}
                {c.platform && <span className="bg-white/10 rounded px-1.5">{c.platform}</span>}
                {c.last_contacted && <span>Last: {formatDate(c.last_contacted)}</span>}
              </div>
            </div>
            <span className="text-neutral-600">›</span>
          </div>
        )
      })}
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
}: {
  title: string
  form: Record<string, unknown>
  setForm: (f: (prev: Record<string, unknown>) => Record<string, unknown>) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4 mb-5">
      <div className="text-sm font-semibold mb-3">{title}</div>
      <label className="block text-xs text-neutral-500 mb-1">Name *</label>
      <input
        className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-3"
        value={(form.name as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        autoFocus
      />
      <label className="block text-xs text-neutral-500 mb-1">Business / Brand</label>
      <input
        className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-3"
        value={(form.business as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))}
      />
      <div className="grid grid-cols-2 gap-2 mb-3">
        <select
          className="rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
          value={(form.platform as string) || ''}
          onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
        >
          <option value="">Platform…</option>
          {PLATFORMS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input
          className="rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
          placeholder="Service"
          value={(form.service as string) || ''}
          onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
        />
      </div>
      <label className="block text-xs text-neutral-500 mb-1">Daily message context</label>
      <textarea
        className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-3"
        value={(form.notes as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
      />
      <label className="block text-xs text-neutral-500 mb-1">Message tone</label>
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {TONES.map((t) => (
          <button
            key={t}
            onClick={() => setForm((f) => ({ ...f, tone: t }))}
            className={`px-3 py-1 rounded text-xs border ${form.tone === t ? 'bg-white text-black border-white' : 'border-white/15 text-neutral-400'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <label className="block text-xs text-neutral-500 mb-1">Talking points</label>
      <textarea
        className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-3"
        value={(form.talking_points as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, talking_points: e.target.value }))}
      />
      <label className="block text-xs text-neutral-500 mb-1">Check-in cadence</label>
      <select
        className="w-full rounded border border-white/10 bg-black/30 px-2 py-2 text-sm mb-3"
        value={(form.cadence_days as number) || 7}
        onChange={(e) => setForm((f) => ({ ...f, cadence_days: Number(e.target.value) }))}
      >
        <option value={1}>Daily</option>
        <option value={2}>Every 2 days</option>
        <option value={7}>Weekly</option>
        <option value={14}>Bi-weekly</option>
        <option value={30}>Monthly</option>
      </select>
      <label className="block text-xs text-neutral-500 mb-1">Pipeline stage</label>
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
            {st}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div>
          <label className="block text-xs text-neutral-500 mb-1">Monthly retainer ($)</label>
          <input
            type="number"
            className="w-full rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
            value={(form.retainer as string) || ''}
            onChange={(e) => setForm((f) => ({ ...f, retainer: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500 mb-1">Contract ends</label>
          <input
            type="date"
            className="w-full rounded border border-white/10 bg-black/30 px-2 py-2 text-sm"
            value={(form.contract_ends as string) || ''}
            onChange={(e) => setForm((f) => ({ ...f, contract_ends: e.target.value }))}
          />
        </div>
      </div>
      <label className="block text-xs text-neutral-500 mb-1">Contact email</label>
      <div className="text-xs text-neutral-600 mb-1">Matches Gmail messages to this client (leave blank to match by domain instead)</div>
      <input
        type="email"
        className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-3"
        placeholder="jane@acme.com"
        value={(form.contact_email as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
      />
      <label className="block text-xs text-neutral-500 mb-1">Contact domain</label>
      <input
        className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-4"
        placeholder="acme.com"
        value={(form.contact_domain as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, contact_domain: e.target.value }))}
      />
      <div className="flex gap-2">
        <button className="rounded border border-white/10 px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="flex-1 rounded bg-white text-black px-3 py-1.5 text-sm font-medium" onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  )
}
