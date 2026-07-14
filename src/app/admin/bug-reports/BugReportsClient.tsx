'use client'

import { useState } from 'react'
import { toast } from 'sonner'

export type BugReportRow = {
  id: string
  userEmail: string | null
  orgName: string | null
  pageUrl: string | null
  description: string
  status: 'new' | 'acknowledged' | 'resolved'
  createdAt: string
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-red-100 text-red-700',
  acknowledged: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green/10 text-green',
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function BugReportsClient({ reports }: { reports: BugReportRow[] }) {
  const [rows, setRows] = useState(reports)

  async function setStatus(id: string, status: BugReportRow['status']) {
    const prev = rows
    setRows((r) => r.map((row) => (row.id === id ? { ...row, status } : row)))
    const res = await fetch(`/api/admin/bug-reports/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      setRows(prev)
      toast.error('Could not update status')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-heading font-bold text-lg">Bug reports</h1>
        <div className="text-xs text-sage">{rows.length} report{rows.length === 1 ? '' : 's'}</div>
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-ink/10 bg-white p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="text-xs text-sage">
                <span className="font-medium text-ink">{r.userEmail ?? 'unknown'}</span>
                {r.orgName && <> · {r.orgName}</>}
                {r.pageUrl && <> · {r.pageUrl}</>}
                {' · '}
                {formatDate(r.createdAt)}
              </div>
              <select
                value={r.status}
                onChange={(e) => setStatus(r.id, e.target.value as BugReportRow['status'])}
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium border-0 ${STATUS_STYLES[r.status]}`}
              >
                <option value="new">New</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className="text-sm whitespace-pre-wrap">{r.description}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-center text-sage py-8">No bug reports yet</div>}
      </div>
    </div>
  )
}
