'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useConfirm } from '@/components/ConfirmDialog'
import Button from '@/components/ui/Button'
import IconButton from '@/components/ui/IconButton'
import CustomSelect from '@/components/ui/CustomSelect'
import DatePicker from '@/components/ui/DatePicker'
import { PencilIcon, TrashIcon, XIcon } from '@/components/ui/icons'
import { centsToDollars, dollarsToCents, formatDate, todayKey } from '@/lib/agency'
import { computeBudgetBurn, type BudgetType } from '@/lib/burn'

type Budget = {
  id: string
  name: string
  type: BudgetType
  amount_cents: number | null
  hours_cap: number | null
  start_date: string
  end_date: string | null
  status: 'active' | 'closed'
}

const TYPE_LABEL: Record<BudgetType, string> = {
  fixed_fee: 'Fixed fee',
  retainer: 'Retainer',
  hourly_cap: 'Hourly cap',
}

const STATUS_COLOR = { ok: '#5d6b5c', warn: '#cc9a3c', high: '#e05070', over: '#e05070' } as const

type BudgetForm = { name: string; type: BudgetType; amount: string; hours_cap: string; start_date: string; end_date: string }

const EMPTY_FORM: BudgetForm = { name: '', type: 'fixed_fee', amount: '', hours_cap: '', start_date: todayKey(), end_date: '' }

export default function ClientBudgets({
  supabase,
  orgId,
  clientId,
  canEdit,
  currencySign,
  targetRateCents,
}: {
  supabase: SupabaseClient
  orgId: string
  clientId: string
  canEdit: boolean
  currencySign: string
  targetRateCents: number
}) {
  const confirm = useConfirm()
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [hoursByBudget, setHoursByBudget] = useState<Record<string, number>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<BudgetForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('budgets')
      .select('id, name, type, amount_cents, hours_cap, start_date, end_date, status')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setBudgets((data as Budget[]) ?? [])
        else toast.error('Could not load budgets')
      })
    supabase
      .from('time_entries')
      .select('budget_id, duration_seconds')
      .eq('client_id', clientId)
      .not('budget_id', 'is', null)
      .not('duration_seconds', 'is', null)
      .then(({ data, error }) => {
        if (error) return
        const totals: Record<string, number> = {}
        for (const e of (data as { budget_id: string; duration_seconds: number }[]) ?? []) {
          totals[e.budget_id] = (totals[e.budget_id] || 0) + e.duration_seconds
        }
        setHoursByBudget(totals)
      })
  }, [supabase, clientId])

  function startEdit(b: Budget) {
    setEditingId(b.id)
    setForm({
      name: b.name,
      type: b.type,
      amount: b.amount_cents ? String(centsToDollars(b.amount_cents)) : '',
      hours_cap: b.hours_cap ? String(b.hours_cap) : '',
      start_date: b.start_date,
      end_date: b.end_date || '',
    })
    setShowAdd(true)
  }

  function resetForm() {
    setShowAdd(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('Give this budget a name')
      return
    }
    if (!form.amount.trim() && !form.hours_cap.trim()) {
      toast.error('Set an amount or an hours cap')
      return
    }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      type: form.type,
      amount_cents: form.amount.trim() ? dollarsToCents(form.amount) : null,
      hours_cap: form.hours_cap.trim() ? Number(form.hours_cap) : null,
      start_date: form.start_date || todayKey(),
      end_date: form.end_date || null,
    }
    if (editingId) {
      const { data, error } = await supabase.from('budgets').update(payload).eq('id', editingId).select().single()
      if (error) toast.error('Could not save budget')
      else setBudgets((prev) => prev.map((b) => (b.id === editingId ? (data as Budget) : b)))
    } else {
      const { data, error } = await supabase
        .from('budgets')
        .insert({ org_id: orgId, client_id: clientId, ...payload })
        .select()
        .single()
      if (error) toast.error('Could not create budget')
      else setBudgets((prev) => [data as Budget, ...prev])
    }
    setSaving(false)
    resetForm()
  }

  async function toggleStatus(b: Budget) {
    const status = b.status === 'active' ? 'closed' : 'active'
    const { error } = await supabase.from('budgets').update({ status }).eq('id', b.id)
    if (error) {
      toast.error('Could not update budget')
      return
    }
    setBudgets((prev) => prev.map((x) => (x.id === b.id ? { ...x, status } : x)))
  }

  async function remove(b: Budget) {
    const ok = await confirm({ title: 'Delete budget', message: `Delete "${b.name}"? Time entries and tasks stay, just unlinked.`, danger: true })
    if (!ok) return
    const { error } = await supabase.from('budgets').delete().eq('id', b.id)
    if (error) {
      toast.error('Could not delete budget')
      return
    }
    setBudgets((prev) => prev.filter((x) => x.id !== b.id))
  }

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold tracking-wide text-sage">Budgets</div>
        {canEdit && !showAdd && (
          <button className="text-xs text-accent font-medium" onClick={() => setShowAdd(true)}>
            + New budget
          </button>
        )}
      </div>

      {budgets.length === 0 && !showAdd && <div className="text-sm text-sage py-2">No budgets yet - a fixed-fee project, a top-up retainer, or an hourly cap to track burn against.</div>}

      {budgets.length > 0 && (
        <div className="flex flex-col gap-2">
          {budgets.map((b) => {
            const hoursLogged = (hoursByBudget[b.id] || 0) / 3600
            const burn = computeBudgetBurn(b, hoursLogged, targetRateCents)
            const color = burn ? STATUS_COLOR[burn.status] : '#5d6b5c'
            return (
              <div key={b.id} className={`rounded-md border border-ink/10 px-3 py-2 ${b.status === 'closed' ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{b.name}</span>
                    <span className="text-xs text-sage bg-ink/5 rounded-full px-1.5 py-0.5 shrink-0">{TYPE_LABEL[b.type]}</span>
                    {b.status === 'closed' && <span className="text-xs text-sage shrink-0">Closed</span>}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <IconButton label={b.status === 'active' ? 'Close' : 'Reopen'} icon={<XIcon size={12} />} onClick={() => toggleStatus(b)} />
                      <IconButton label="Edit" icon={<PencilIcon size={12} />} onClick={() => startEdit(b)} />
                      <IconButton label="Delete" tone="red" icon={<TrashIcon size={12} />} onClick={() => remove(b)} />
                    </div>
                  )}
                </div>
                <div className="text-xs text-sage mt-1 flex items-center gap-2 flex-wrap">
                  {!!b.hours_cap && <span>{hoursLogged.toFixed(1)}h of {b.hours_cap}h</span>}
                  {!b.hours_cap && !!b.amount_cents && burn?.spentCents != null && (
                    <span>
                      {currencySign}
                      {centsToDollars(burn.spentCents).toLocaleString()} of {currencySign}
                      {centsToDollars(b.amount_cents).toLocaleString()}
                    </span>
                  )}
                  {!!b.amount_cents && !!b.hours_cap && (
                    <span>
                      {currencySign}
                      {centsToDollars(b.amount_cents).toLocaleString()} cap
                    </span>
                  )}
                  {burn && (
                    <span className="font-semibold rounded-full px-1.5 py-0.5" style={{ color, background: `${color}18` }}>
                      {Math.round(burn.percent)}%
                    </span>
                  )}
                  <span>
                    {formatDate(b.start_date)}
                    {b.end_date ? ` – ${formatDate(b.end_date)}` : ' – ongoing'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && canEdit && (
        <div className="rounded-md border border-ink/10 p-3 mt-2 flex flex-col gap-2">
          <input
            className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm"
            placeholder="Budget name (e.g. Website redesign)"
            value={form.name}
            autoFocus
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="flex gap-2 flex-wrap">
            <CustomSelect
              value={form.type}
              onChange={(v) => setForm((f) => ({ ...f, type: v as BudgetType }))}
              options={[
                { value: 'fixed_fee', label: 'Fixed fee' },
                { value: 'retainer', label: 'Retainer' },
                { value: 'hourly_cap', label: 'Hourly cap' },
              ]}
              className="w-32"
            />
            <input
              className="rounded border border-ink/10 bg-white px-3 py-2 text-sm w-28"
              placeholder={`Amount (${currencySign})`}
              type="number"
              min="0"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <input
              className="rounded border border-ink/10 bg-white px-3 py-2 text-sm w-24"
              placeholder="Hours cap"
              type="number"
              min="0"
              value={form.hours_cap}
              onChange={(e) => setForm((f) => ({ ...f, hours_cap: e.target.value }))}
            />
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <DatePicker value={form.start_date} onChange={(v) => setForm((f) => ({ ...f, start_date: v }))} placeholder="Start date" />
            <span className="text-xs text-sage">to</span>
            <DatePicker value={form.end_date} onChange={(v) => setForm((f) => ({ ...f, end_date: v }))} placeholder="No end date" />
          </div>
          <div className="flex justify-end gap-2 mt-1">
            <Button variant="secondary" disabled={saving} onClick={resetForm}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : editingId ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
