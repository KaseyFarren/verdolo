'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import { TrashIcon } from '@/components/ui/icons'
import { centsToDollars, currencySymbol, dollarsToCents, formatDate, type Currency } from '@/lib/agency'

type Status = 'draft' | 'sent' | 'signed' | 'declined'
type PricingRow = { label: string; amount: string }
type ProposalContent = { overview: string; deliverables: string[]; pricing: PricingRow[]; terms: string }
type Proposal = {
  id: string
  title: string
  status: Status
  content: Partial<ProposalContent> | null
  share_token: string | null
  share_revoked_at: string | null
  accepted_at: string | null
  accepted_by_name: string | null
}

const STATUS_LABEL: Record<Status, string> = { draft: 'Draft', sent: 'Sent', signed: 'Signed', declined: 'Declined' }

function emptyContent(c: Partial<ProposalContent> | null): ProposalContent {
  return {
    overview: c?.overview ?? '',
    deliverables: c?.deliverables ?? [],
    pricing: c?.pricing?.length ? c.pricing : [{ label: '', amount: '' }],
    terms: c?.terms ?? '',
  }
}

// Same repeating-row add/remove shape as PhaseListEditor (src/components/projects/ProjectFormModal.tsx).
function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (items: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('')
  function commit() {
    if (!draft.trim()) return
    onChange([...items, draft.trim()])
    setDraft('')
  }
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          <span className="flex-1 text-sm">{item}</span>
          <button type="button" className="text-sage hover:text-red-600 shrink-0" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            <TrashIcon size={13} />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={commit}>
          Add
        </Button>
      </div>
    </div>
  )
}

export default function ProposalEditorClient({
  canEdit,
  initialProposal,
  clientName,
  currency,
}: {
  canEdit: boolean
  initialProposal: Proposal
  clientName: string
  currency?: Currency
}) {
  const currencySign = currencySymbol(currency)
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()
  const [proposal, setProposal] = useState(initialProposal)
  const [content, setContent] = useState<ProposalContent>(emptyContent(initialProposal.content))
  const [saving, setSaving] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  // window is undefined during SSR - resolve the origin after mount rather than reading it
  // directly in render, matching how forgot-password/create-account build redirect URLs.
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])

  const total = content.pricing.reduce((sum, row) => sum + dollarsToCents(row.amount || '0'), 0)

  async function save() {
    setSaving(true)
    const { data, error } = await supabase
      .from('proposals')
      .update({ content, amount_cents: total })
      .eq('id', proposal.id)
      .select()
      .single()
    setSaving(false)
    if (error || !data) {
      toast.error('Failed to save proposal')
      return
    }
    setProposal(data as Proposal)
    toast.success('Proposal saved')
  }

  async function generateLink() {
    setLinkBusy(true)
    const { data, error } = await supabase
      .from('proposals')
      .update({ share_token: crypto.randomUUID(), share_revoked_at: null })
      .eq('id', proposal.id)
      .select()
      .single()
    setLinkBusy(false)
    if (error || !data) {
      toast.error('Failed to create share link')
      return
    }
    setProposal(data as Proposal)
    toast.success('Share link created')
  }

  async function revokeLink() {
    const ok = await confirm({ title: 'Revoke this link?', message: 'The current link will stop working immediately. You can generate a new one anytime.', confirmLabel: 'Revoke', danger: true })
    if (!ok) return
    const { data, error } = await supabase
      .from('proposals')
      .update({ share_revoked_at: new Date().toISOString() })
      .eq('id', proposal.id)
      .select()
      .single()
    if (error || !data) {
      toast.error('Failed to revoke link')
      return
    }
    setProposal(data as Proposal)
    toast.success('Link revoked')
  }

  async function copyLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy - copy the link manually')
    }
  }

  const shareUrl = proposal.share_token && !proposal.share_revoked_at && origin ? `${origin}/proposal/${proposal.share_token}` : null

  return (
    <div className="max-w-2xl">
      <Link href="/proposals" className="text-xs text-sage hover:text-ink">← Back to Proposals</Link>
      <div className="flex items-center justify-between mt-2 mb-5">
        <div>
          <h1 className="text-xl font-semibold">{proposal.title}</h1>
          <div className="text-xs text-sage mt-0.5">{clientName} · {STATUS_LABEL[proposal.status]}</div>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <Card>
          <div className="text-xs font-semibold tracking-wide text-sage mb-2">Overview</div>
          <textarea
            className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm min-h-[90px]"
            placeholder="What this proposal covers…"
            value={content.overview}
            onChange={(e) => setContent((c) => ({ ...c, overview: e.target.value }))}
            disabled={!canEdit}
          />
        </Card>

        <Card>
          <div className="text-xs font-semibold tracking-wide text-sage mb-2">Deliverables</div>
          <ListEditor
            items={content.deliverables}
            onChange={(deliverables) => setContent((c) => ({ ...c, deliverables }))}
            placeholder="Add a deliverable…"
          />
        </Card>

        <Card>
          <div className="text-xs font-semibold tracking-wide text-sage mb-2">Pricing</div>
          {content.pricing.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_28px] gap-2 mb-1.5 items-center">
              <input
                className="rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
                placeholder="Line item"
                value={row.label}
                onChange={(e) => setContent((c) => ({ ...c, pricing: c.pricing.map((r, idx) => (idx === i ? { ...r, label: e.target.value } : r)) }))}
              />
              <input
                type="number"
                min="0"
                className="rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
                placeholder={currencySign}
                value={row.amount}
                onChange={(e) => setContent((c) => ({ ...c, pricing: c.pricing.map((r, idx) => (idx === i ? { ...r, amount: e.target.value } : r)) }))}
              />
              <button
                type="button"
                className="text-sage hover:text-red-600 disabled:opacity-30"
                disabled={content.pricing.length <= 1}
                onClick={() => setContent((c) => ({ ...c, pricing: c.pricing.filter((_, idx) => idx !== i) }))}
              >
                <TrashIcon size={13} />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between mt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setContent((c) => ({ ...c, pricing: [...c.pricing, { label: '', amount: '' }] }))}>
              + Add line
            </Button>
            <div className="text-sm font-semibold">Total: {currencySign}{centsToDollars(total).toLocaleString()}</div>
          </div>
        </Card>

        <Card>
          <div className="text-xs font-semibold tracking-wide text-sage mb-2">Terms</div>
          <textarea
            className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm min-h-[90px]"
            placeholder="Payment terms, timeline, cancellation policy…"
            value={content.terms}
            onChange={(e) => setContent((c) => ({ ...c, terms: e.target.value }))}
            disabled={!canEdit}
          />
        </Card>

        {canEdit && (
          <Card>
            <div className="text-xs font-semibold tracking-wide text-sage mb-2">Share link</div>
            {proposal.accepted_at ? (
              <div className="text-sm text-green">
                Accepted by {proposal.accepted_by_name} on {formatDate(proposal.accepted_at.slice(0, 10))}
              </div>
            ) : shareUrl ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input readOnly className="flex-1 rounded-md border border-ink/10 bg-sand px-3 py-2 text-sm text-sage" value={shareUrl} />
                  <Button type="button" variant="secondary" size="sm" onClick={copyLink}>Copy</Button>
                </div>
                <button type="button" className="text-xs text-sage hover:text-red-600 self-start" onClick={revokeLink}>
                  Revoke link
                </button>
              </div>
            ) : (
              <Button type="button" variant="secondary" onClick={generateLink} disabled={linkBusy}>
                {linkBusy ? 'Creating…' : proposal.share_revoked_at ? 'Generate new link' : 'Generate share link'}
              </Button>
            )}
            <div className="text-xs text-sage/70 mt-2">Save your changes before sharing - the link always shows the latest saved version.</div>
          </Card>
        )}
      </div>
    </div>
  )
}
