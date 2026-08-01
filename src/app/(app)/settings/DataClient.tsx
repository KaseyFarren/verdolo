'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import { Row, Section, triggerDownload } from '@/components/settings/SettingsUI'
import { formatDate, memberName, todayKey } from '@/lib/agency'

type ArchivedTask = {
  id: string
  title: string
  client_id: string | null
  assigned_to: string | null
  completed_at: string | null
  archived_at: string | null
}

const ARCHIVE_RETENTION_DAYS = 60

// Mirrors the RETENTION_DAYS cutoff in api/cron/archive-cleanup/route.ts.
function purgeLabel(archivedAt: string) {
  const daysLeft = ARCHIVE_RETENTION_DAYS - Math.floor((Date.now() - new Date(archivedAt).getTime()) / 86400000)
  return daysLeft > 0 ? `purges in ${daysLeft}d` : 'purging soon'
}

export default function DataClient({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()

  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archived, setArchived] = useState<ArchivedTask[] | null>(null)
  const [clientNames, setClientNames] = useState<Record<string, string>>({})
  const [memberLabels, setMemberLabels] = useState<Record<string, string>>({})

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
      ['Name', 'Business', 'Stage', 'Billing Mode', 'Retainer', 'Hourly Rate', 'Platform', 'Service', 'Tone', 'Last Contacted', 'Contract Ends'],
      ...(clients || []).map((c) => [
        c.name,
        c.business || '',
        c.stage || '',
        c.billing_mode || 'retainer',
        c.retainer_cents ? c.retainer_cents / 100 : '',
        c.hourly_rate_cents ? c.hourly_rate_cents / 100 : '',
        c.platform || '',
        c.service || '',
        c.tone || '',
        c.last_contacted || '',
        c.contract_ends || '',
      ]),
    ]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    triggerDownload(csv, `verdolo-clients-${todayKey()}.csv`, 'text/csv')
  }

  // Archives rather than deletes - Revenue and Reports query the tasks table directly by date
  // range, so a hard delete here used to silently zero out historical completion counts.
  async function clearCompleted() {
    const ok = await confirm({
      message: "Archive all completed tasks? They'll be hidden from your task list but kept for reporting - view or restore them anytime from Archived tasks below.",
      confirmLabel: 'Archive',
    })
    if (!ok) return
    await supabase.from('tasks').update({ archived: true, archived_at: new Date().toISOString() }).eq('org_id', orgId).eq('done', true).eq('archived', false)
    toast.success('Completed tasks archived')
    if (archiveOpen) loadArchived()
  }

  async function loadArchived() {
    setArchiveLoading(true)
    const [{ data: tasks }, { data: clients }, { data: members }] = await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, client_id, assigned_to, completed_at, archived_at')
        .eq('org_id', orgId)
        .eq('archived', true)
        .order('archived_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('org_id', orgId),
      supabase.from('org_members').select('user_id, invited_email, display_name').eq('org_id', orgId),
    ])
    setArchived((tasks as ArchivedTask[]) ?? [])
    setClientNames(Object.fromEntries((clients ?? []).map((c) => [c.id, c.name])))
    setMemberLabels(Object.fromEntries((members ?? []).map((m) => [m.user_id, memberName(m)])))
    setArchiveLoading(false)
  }

  async function toggleArchive() {
    const next = !archiveOpen
    setArchiveOpen(next)
    if (next && archived === null) await loadArchived()
  }

  async function restoreTask(id: string) {
    await supabase.from('tasks').update({ archived: false, archived_at: null }).eq('id', id)
    setArchived((prev) => (prev ?? []).filter((t) => t.id !== id))
    toast.success('Task restored')
  }

  async function clearTasks() {
    if (!isAdmin) return
    const ok = await confirm({
      title: 'Clear all tasks?',
      message: 'This permanently deletes every task for this org. Clients, time logs, and revenue records are kept, and completed-task history stays on your reports. This cannot be undone.',
      confirmLabel: 'Clear tasks',
      danger: true,
    })
    if (!ok) return
    const res = await fetch('/api/data/clear-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Could not clear tasks' }))
      toast.error(error || 'Could not clear tasks')
      return
    }
    toast.success('All tasks cleared')
    if (archiveOpen) loadArchived()
  }

  async function resetAll() {
    if (!isAdmin) return
    const ok = await confirm({
      title: 'Delete all org data?',
      message: 'This permanently deletes every client, task, message, time entry, and uploaded file for this org. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true,
    })
    if (!ok) return
    const res = await fetch('/api/data/reset-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Could not reset org data' }))
      toast.error(error || 'Could not reset org data')
      return
    }
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
      <Row title="Clear completed tasks" subtitle="Archive tasks marked as done - hides them from your task list, keeps them for reporting">
        <button className="text-xs text-red-600" onClick={clearCompleted}>
          Clear
        </button>
      </Row>
      <Row title="Archived tasks" subtitle="View or restore tasks you've archived - auto-deleted 60 days after archiving (completion counts are preserved for reporting)">
        <button className="text-xs rounded border border-ink/10 px-2 py-1" onClick={toggleArchive}>
          {archiveOpen ? 'Hide' : 'View'}
        </button>
      </Row>
      {archiveOpen && (
        <div className="mt-2 mb-4 rounded-lg border border-ink/10 divide-y divide-ink/5 max-h-80 overflow-y-auto">
          {archiveLoading && <div className="text-xs text-sage p-3">Loading...</div>}
          {!archiveLoading && archived?.length === 0 && <div className="text-xs text-sage p-3">No archived tasks.</div>}
          {!archiveLoading &&
            archived?.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{t.title}</div>
                  <div className="text-xs text-sage truncate">
                    {[
                      t.client_id ? clientNames[t.client_id] : null,
                      t.assigned_to ? memberLabels[t.assigned_to] : null,
                      t.completed_at ? `completed ${formatDate(t.completed_at.slice(0, 10))}` : null,
                      t.archived_at ? purgeLabel(t.archived_at) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <button className="text-xs shrink-0 underline" onClick={() => restoreTask(t.id)}>
                  Restore
                </button>
              </div>
            ))}
        </div>
      )}
      {isAdmin && (
        <Row title="Clear all tasks" subtitle="Delete every task, but keep clients, time logs, revenue, and completed-task history">
          <button className="text-xs text-red-600" onClick={clearTasks}>
            Clear tasks
          </button>
        </Row>
      )}
      {isAdmin && (
        <Row title="Reset all data" subtitle="Delete everything for this org - clients, tasks, messages, time entries, reports, and uploaded files">
          <button className="text-xs text-red-600" onClick={resetAll}>
            Reset
          </button>
        </Row>
      )}
    </Section>
  )
}
