'use client'

import { useMemo } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import { Row, Section, triggerDownload } from '@/components/settings/SettingsUI'
import { todayKey } from '@/lib/agency'

export default function DataClient({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()

  async function exportJSON() {
    const [{ data: clients }, { data: tasks }, { data: notes }] = await Promise.all([
      supabase.from('clients').select('*').eq('org_id', orgId),
      supabase.from('tasks').select('*').eq('org_id', orgId),
      supabase.from('client_notes').select('*').eq('org_id', orgId),
    ])
    triggerDownload(JSON.stringify({ clients, tasks, notes, exported: new Date().toISOString() }, null, 2), `verdolo-export-${todayKey()}.json`, 'application/json')
  }

  async function exportCSV() {
    const { data: clients } = await supabase.from('clients').select('*').eq('org_id', orgId)
    const rows = [
      ['Name', 'Business', 'Stage', 'Retainer', 'Platform', 'Service', 'Tone', 'Last Contacted', 'Contract Ends'],
      ...(clients || []).map((c) => [c.name, c.business || '', c.stage || '', c.retainer_cents ? c.retainer_cents / 100 : '', c.platform || '', c.service || '', c.tone || '', c.last_contacted || '', c.contract_ends || '']),
    ]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    triggerDownload(csv, `verdolo-clients-${todayKey()}.csv`, 'text/csv')
  }

  async function clearCompleted() {
    const ok = await confirm({ message: 'Clear all completed tasks?', confirmLabel: 'Clear' })
    if (!ok) return
    await supabase.from('tasks').delete().eq('org_id', orgId).eq('done', true)
    toast.success('Completed tasks cleared')
  }

  async function resetAll() {
    if (!isAdmin) return
    const ok = await confirm({
      title: 'Delete all org data?',
      message: 'This permanently deletes every client, task, and note for this org. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true,
    })
    if (!ok) return
    await supabase.from('tasks').delete().eq('org_id', orgId)
    await supabase.from('client_notes').delete().eq('org_id', orgId)
    await supabase.from('clients').delete().eq('org_id', orgId)
    toast.success('All org data deleted')
  }

  return (
    <Section label="Data">
      <Row title="Export all data (JSON)" subtitle="Full backup - clients, tasks, notes">
        <button className="text-xs rounded border border-ink/10 px-2 py-1" onClick={exportJSON}>
          Export
        </button>
      </Row>
      <Row title="Export clients (CSV)" subtitle="Spreadsheet-ready client list">
        <button className="text-xs rounded border border-ink/10 px-2 py-1" onClick={exportCSV}>
          Export
        </button>
      </Row>
      <Row title="Clear completed tasks" subtitle="Remove all tasks marked as done">
        <button className="text-xs text-red-600" onClick={clearCompleted}>
          Clear
        </button>
      </Row>
      {isAdmin && (
        <Row title="Reset all data" subtitle="Delete tasks, clients, and notes for this org">
          <button className="text-xs text-red-600" onClick={resetAll}>
            Reset
          </button>
        </Row>
      )}
    </Section>
  )
}
