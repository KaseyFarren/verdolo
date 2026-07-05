'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate, memberName } from '@/lib/agency'
import type { ReportRange } from './page'

type Client = { id: string; name: string }
type Task = { id: string; client_id: string | null; assigned_to: string | null; title: string; completed_at: string | null }
type TimeEntry = { client_id: string | null; user_id: string; duration_seconds: number | null }
type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null }
type WeeklyReport = { week_start: string; content: string }

const RANGE_LABELS: Record<ReportRange, string> = {
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

export default function ReportsClient({
  orgId,
  range,
  clients,
  tasks,
  entries,
  members,
  reports,
  weekAnchor,
  hasApiKey,
}: {
  orgId: string
  range: ReportRange
  clients: Client[]
  tasks: Task[]
  entries: TimeEntry[]
  members: Member[]
  reports: WeeklyReport[]
  weekAnchor: string
  hasApiKey: boolean
}) {
  const router = useRouter()
  const [recap, setRecap] = useState<string | null>(reports.find((r) => r.week_start === weekAnchor)?.content ?? null)
  const [loadingRecap, setLoadingRecap] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function generateRecap() {
    setLoadingRecap(true)
    try {
      const res = await fetch('/api/ai/weekly-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const body = await res.json()
      setRecap(res.ok ? body.recap : body.error || 'Failed to generate.')
      router.refresh()
    } finally {
      setLoadingRecap(false)
    }
  }

  function toggleExpanded(weekStart: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(weekStart)) next.delete(weekStart)
      else next.add(weekStart)
      return next
    })
  }

  const clientReports = useMemo(() => {
    return clients
      .map((c) => {
        const clientTasks = tasks.filter((t) => t.client_id === c.id)
        const clientEntries = entries.filter((e) => e.client_id === c.id)
        const totalSeconds = clientEntries.reduce((s, e) => s + (e.duration_seconds || 0), 0)

        const byAssignee = new Map<string, { label: string; count: number }>()
        for (const t of clientTasks) {
          const key = t.assigned_to || 'unassigned'
          const label = t.assigned_to ? memberName(members.find((m) => m.user_id === t.assigned_to)) : 'Unassigned'
          const existing = byAssignee.get(key)
          if (existing) existing.count += 1
          else byAssignee.set(key, { label, count: 1 })
        }

        const byLogger = new Map<string, { label: string; seconds: number }>()
        for (const e of clientEntries) {
          const existing = byLogger.get(e.user_id)
          if (existing) existing.seconds += e.duration_seconds || 0
          else byLogger.set(e.user_id, { label: memberName(members.find((m) => m.user_id === e.user_id)), seconds: e.duration_seconds || 0 })
        }

        return {
          client: c,
          taskCount: clientTasks.length,
          totalSeconds,
          tasks: clientTasks,
          byAssignee: [...byAssignee.values()].sort((a, b) => b.count - a.count),
          byLogger: [...byLogger.values()].sort((a, b) => b.seconds - a.seconds),
        }
      })
      .filter((r) => r.taskCount > 0 || r.totalSeconds > 0)
      .sort((a, b) => b.taskCount + b.totalSeconds / 3600 - (a.taskCount + a.totalSeconds / 3600))
  }, [clients, tasks, entries, members])

  function onRangeChange(next: string) {
    router.push(`/reports?range=${next}`)
  }

  return (
    <div>
      <div className="mb-5">
        <div className="font-heading text-2xl font-bold text-ink">Reports</div>
        <div className="text-sm text-sage mt-1">Client activity, team contribution, and the weekly recap library.</div>
      </div>

      <div className="mb-6">
        <select
          value={range}
          onChange={(e) => onRangeChange(e.target.value)}
          className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink shadow-md"
        >
          {(Object.keys(RANGE_LABELS) as ReportRange[]).map((r) => (
            <option key={r} value={r}>
              {RANGE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-8">
        <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Weekly overall recap</div>
        {recap ? (
          <div className="rounded-2xl bg-white shadow-md border-l-4 border-accent p-4">
            <div className="flex justify-between items-center mb-2">
              <div className="text-xs font-semibold uppercase text-sage">Week of {formatDate(weekAnchor)}</div>
              <button className="text-xs text-sage hover:text-ink" onClick={generateRecap} disabled={loadingRecap}>
                ↺ Regenerate
              </button>
            </div>
            <div className="text-sm leading-relaxed text-ink">{loadingRecap ? 'Generating…' : recap}</div>
          </div>
        ) : (
          <button
            className="w-full rounded-xl border border-ink/10 bg-white py-2 text-sm text-sage shadow-md disabled:opacity-50"
            onClick={generateRecap}
            disabled={loadingRecap || !hasApiKey}
          >
            {loadingRecap ? '⏳ Generating recap…' : hasApiKey ? '✨ Generate weekly recap' : 'AI generation is not available right now'}
          </button>
        )}
      </div>

      <div className="mb-8">
        <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">
          By client · {RANGE_LABELS[range]}
        </div>
        {clientReports.length === 0 ? (
          <div className="text-sm text-sage py-3">No task or time activity in this range.</div>
        ) : (
          <div className="space-y-3">
            {clientReports.map((r) => (
              <div key={r.client.id} className="rounded-2xl bg-white shadow-md p-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="text-sm font-semibold text-ink">{r.client.name}</div>
                  <div className="flex gap-3 text-xs text-sage">
                    <span>
                      {r.taskCount} task{r.taskCount !== 1 ? 's' : ''} done
                    </span>
                    <span>{formatDuration(r.totalSeconds)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-sage/70 mb-1">Tasks by who</div>
                    {r.byAssignee.length === 0 ? (
                      <div className="text-xs text-sage">—</div>
                    ) : (
                      r.byAssignee.map((a) => (
                        <div key={a.label} className="flex justify-between text-xs py-0.5">
                          <span className="text-ink">{a.label}</span>
                          <span className="text-sage">{a.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-sage/70 mb-1">Time by who</div>
                    {r.byLogger.length === 0 ? (
                      <div className="text-xs text-sage">—</div>
                    ) : (
                      r.byLogger.map((l) => (
                        <div key={l.label} className="flex justify-between text-xs py-0.5">
                          <span className="text-ink">{l.label}</span>
                          <span className="text-sage">{formatDuration(l.seconds)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Report library</div>
        {reports.length === 0 ? (
          <div className="text-sm text-sage py-3">No past reports yet.</div>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => {
              const isOpen = expanded.has(r.week_start)
              return (
                <div key={r.week_start} className="rounded-2xl bg-white shadow-md p-4">
                  <button className="flex w-full justify-between items-center text-left" onClick={() => toggleExpanded(r.week_start)}>
                    <span className="text-xs font-semibold text-sage">Week of {formatDate(r.week_start)}</span>
                    <span className="text-xs text-sage">{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && <div className="text-sm leading-relaxed text-ink mt-2">{r.content}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
