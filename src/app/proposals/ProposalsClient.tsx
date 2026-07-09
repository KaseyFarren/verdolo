'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import Button from '@/components/ui/Button'
import CustomSelect from '@/components/ui/CustomSelect'
import { centsToDollars, dollarsToCents, formatDate } from '@/lib/agency'

type Status = 'draft' | 'sent' | 'signed' | 'declined'
type Proposal = {
  id: string
  client_id: string
  title: string
  amount_cents: number
  status: Status
  notes: string | null
  doc_url: string | null
  sent_at: string | null
  decided_at: string | null
  created_at: string
}
type Client = { id: string; name: string }

const STATUS_STYLE: Record<Status, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#7a7a6e', bg: '#7a7a6e1a' },
  sent: { label: 'Sent', color: '#cc9a3c', bg: '#cc9a3c1a' },
  signed: { label: 'Signed', color: '#2db87a', bg: '#2db87a1a' },
  declined: { label: 'Declined', color: '#e05070', bg: '#e050701a' },
}

const emptyForm = { client_id: '', title: '', amount: '', notes: '', doc_url: '' }

type ClientMode = 'existing' | 'new'

export default function ProposalsClient({
  orgId,
  canEdit,
  initialProposals,
  clients,
}: {
  orgId: string
  canEdit: boolean
  initialProposals: Proposal[]
  clients: Client[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals)
  const [clientList, setClientList] = useState<Client[]>(clients)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [clientMode, setClientMode] = useState<ClientMode>('existing')
  const [newClientName, setNewClientName] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState<Status | ''>('')
  const [clientFilter, setClientFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    setClientList(clients)
  }, [clients])

  function clientName(id: string) {
    return clientList.find((c) => c.id === id)?.name ?? 'Unknown client'
  }

  // Proposals often go out to prospects who aren't clients yet - creating one inline (as a
  // 'Lead' in the existing pipeline stage) avoids forcing a separate trip to Clients first.
  async function resolveClientId(): Promise<string | null> {
    if (clientMode === 'existing') return form.client_id || null
    const name = newClientName.trim()
    if (!name) return null
    const { data, error } = await supabase.from('clients').insert({ org_id: orgId, name, stage: 'Lead' }).select('id, name').single()
    if (error || !data) {
      toast.error('Failed to create client')
      return null
    }
    setClientList((prev) => [...prev, data as Client].sort((a, b) => a.name.localeCompare(b.name)))
    return data.id
  }

  async function addProposal() {
    if (!form.title.trim()) return
    if (clientMode === 'existing' && !form.client_id) return
    if (clientMode === 'new' && !newClientName.trim()) return
    setSaving(true)
    const clientId = await resolveClientId()
    if (!clientId) {
      setSaving(false)
      return
    }
    const { data, error } = await supabase
      .from('proposals')
      .insert({
        org_id: orgId,
        client_id: clientId,
        title: form.title.trim(),
        amount_cents: dollarsToCents(form.amount || '0'),
        notes: form.notes.trim() || null,
        doc_url: form.doc_url.trim() || null,
      })
      .select()
      .single()
    setSaving(false)
    if (error) {
      toast.error('Failed to create proposal')
      return
    }
    const created = data as Proposal
    setProposals((prev) => [created, ...prev])
    // Clear filters so the proposal just created can't be hidden by a stale status/client filter.
    setStatusFilter('')
    setClientFilter('')
    setExpanded((prev) => new Set(prev).add(created.id))
    setForm(emptyForm)
    setNewClientName('')
    setClientMode('existing')
    setShowAdd(false)
    toast.success(clientMode === 'new' ? 'Client and proposal created' : 'Proposal created')
  }

  async function setStatus(p: Proposal, status: Status) {
    const patch: Partial<Proposal> = { status }
    if (status === 'sent') patch.sent_at = new Date().toISOString()
    if (status === 'signed' || status === 'declined') patch.decided_at = new Date().toISOString()
    const { data } = await supabase.from('proposals').update(patch).eq('id', p.id).select().single()
    if (data) setProposals((prev) => prev.map((x) => (x.id === p.id ? (data as Proposal) : x)))
  }

  async function deleteProposal(p: Proposal) {
    const ok = await confirm({ title: `Delete "${p.title}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    await supabase.from('proposals').delete().eq('id', p.id)
    setProposals((prev) => prev.filter((x) => x.id !== p.id))
    toast.success('Proposal deleted')
  }

  const sorted = [...proposals]
    .filter((p) => !statusFilter || p.status === statusFilter)
    .filter((p) => !clientFilter || p.client_id === clientFilter)
    .sort((a, b) => {
      const order: Record<Status, number> = { draft: 0, sent: 1, signed: 2, declined: 3 }
      return order[a.status] - order[b.status] || b.created_at.localeCompare(a.created_at)
    })

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold">Proposals</h1>
        {canEdit && (
          <Button variant="primary" size="lg" className="rounded-full" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? 'Cancel' : '+ New proposal'}
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="rounded-2xl bg-white shadow-md p-4 mb-5 space-y-3">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setClientMode('existing')}
              className={`px-3 py-1 rounded-full text-xs border ${clientMode === 'existing' ? 'bg-accent text-white border-accent' : 'border-ink/15 text-sage'}`}
            >
              Existing client
            </button>
            <button
              type="button"
              onClick={() => setClientMode('new')}
              className={`px-3 py-1 rounded-full text-xs border ${clientMode === 'new' ? 'bg-accent text-white border-accent' : 'border-ink/15 text-sage'}`}
            >
              New prospect
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {clientMode === 'existing' ? (
              <CustomSelect
                value={form.client_id}
                onChange={(v) => setForm((f) => ({ ...f, client_id: v }))}
                placeholder="Select client…"
                options={clientList.map((c) => ({ value: c.id, label: c.name }))}
              />
            ) : (
              <input
                className="rounded border border-ink/10 bg-white px-3 py-2 text-sm"
                placeholder="Prospect / company name"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
              />
            )}
            <input
              className="rounded border border-ink/10 bg-white px-3 py-2 text-sm"
              placeholder="Proposal title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <input
              type="number"
              min="0"
              className="rounded border border-ink/10 bg-white px-3 py-2 text-sm"
              placeholder="Amount ($)"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <input
              className="rounded border border-ink/10 bg-white px-3 py-2 text-sm"
              placeholder="Doc link (optional)"
              value={form.doc_url}
              onChange={(e) => setForm((f) => ({ ...f, doc_url: e.target.value }))}
            />
          </div>
          {clientMode === 'new' && <div className="text-xs text-sage/70 -mt-1">Adds them to Clients as a Lead so they show up in the pipeline too.</div>}
          <textarea
            className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm min-h-[70px]"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <Button
            variant="primary"
            onClick={addProposal}
            disabled={saving || !form.title.trim() || (clientMode === 'existing' ? !form.client_id : !newClientName.trim())}
          >
            {saving ? 'Saving…' : 'Create proposal'}
          </Button>
        </div>
      )}

      {proposals.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <CustomSelect
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as Status | '')}
            options={[{ value: '', label: 'All statuses' }, ...(Object.keys(STATUS_STYLE) as Status[]).map((s) => ({ value: s, label: STATUS_STYLE[s].label }))]}
            className="w-36"
          />
          <CustomSelect
            value={clientFilter}
            onChange={setClientFilter}
            options={[{ value: '', label: 'All clients' }, ...clientList.map((c) => ({ value: c.id, label: c.name }))]}
            className="w-40"
          />
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-sm text-sage py-8 text-center">{proposals.length === 0 ? 'No proposals yet.' : 'No proposals match these filters.'}</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((p) => {
            const style = STATUS_STYLE[p.status]
            const isOpen = expanded.has(p.id)
            const hasDetails = !!p.notes || !!p.doc_url
            return (
              <div key={p.id} className="rounded-2xl bg-white shadow-md p-4">
                <div className="flex justify-between items-start gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => hasDetails && toggleExpanded(p.id)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-semibold text-ink">{p.title}</div>
                      <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ color: style.color, background: style.bg }}>
                        {style.label}
                      </span>
                      {hasDetails && <span className="text-xs text-sage">{isOpen ? '▾' : '▸'}</span>}
                    </div>
                    <div className="text-xs text-sage mt-0.5">
                      {clientName(p.client_id)}
                      {p.amount_cents > 0 && ` · $${centsToDollars(p.amount_cents).toLocaleString()}`} · {formatDate(p.created_at.slice(0, 10))}
                    </div>
                  </button>
                  {canEdit && (
                    <div className="flex items-center gap-2 shrink-0">
                      {p.status === 'draft' && (
                        <button className="text-xs text-sage hover:text-ink" onClick={() => setStatus(p, 'sent')}>
                          Mark sent
                        </button>
                      )}
                      {p.status === 'sent' && (
                        <>
                          <button className="text-xs text-green hover:underline" onClick={() => setStatus(p, 'signed')}>
                            Signed
                          </button>
                          <button className="text-xs text-red-600 hover:underline" onClick={() => setStatus(p, 'declined')}>
                            Declined
                          </button>
                        </>
                      )}
                      <button className="text-xs text-sage hover:text-red-600" onClick={() => deleteProposal(p)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                {isOpen && (p.notes || p.doc_url) && (
                  <div className="mt-2 pt-2 border-t border-ink/5">
                    {p.notes && <div className="text-xs text-sage whitespace-pre-wrap">{p.notes}</div>}
                    {p.doc_url && (
                      <a href={p.doc_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline mt-1.5 inline-block">
                        View document ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
