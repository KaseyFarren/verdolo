import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthorizedCronRequest } from '@/lib/cronAuth'

const RETENTION_DAYS = 60

// Runs daily (see vercel.json). Archived tasks (DataClient.tsx "Clear completed tasks") are
// meant to be a temporary holding area, not permanent storage - this hard-deletes any task
// archived 60+ days ago. Before deleting, it rolls each task's contribution into
// task_archived_totals (migration 0048) so Revenue's completed/overdue/completed-late
// counters stay accurate for old custom date ranges after the row is gone - same reasoning
// as time_archived_totals for the Time page's "clear old entries".
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()

  const { data: eligible } = await admin
    .from('tasks')
    .select('id, org_id, assigned_to, original_due_date, completed_at')
    .eq('archived', true)
    .lt('archived_at', cutoff)
    .limit(5000)

  if (!eligible || eligible.length === 0) return NextResponse.json({ deleted: 0, rolledUp: 0 })

  // Only tasks with both an assignee and an original_due_date feed Revenue's counters
  // (see revenue/page.tsx - it filters assigned_to not null) - the rest are only ever
  // shown via short-lookback live views (Reports, Dashboard) that never reach 60-day-old
  // data, so they can be deleted with no rollup.
  const rollupable = eligible.filter((t) => t.assigned_to && t.original_due_date)

  const deltas = new Map<string, { org_id: string; assigned_to: string; original_due_date: string; completed: number; completed_late: number }>()
  for (const t of rollupable) {
    const key = `${t.org_id}|${t.assigned_to}|${t.original_due_date}`
    const existing = deltas.get(key) || { org_id: t.org_id, assigned_to: t.assigned_to as string, original_due_date: t.original_due_date as string, completed: 0, completed_late: 0 }
    existing.completed += 1
    // Archiving requires done = true (DataClient.tsx clearCompleted), so completed_at is always set here.
    if (t.completed_at && t.completed_at.slice(0, 10) > t.original_due_date!) existing.completed_late += 1
    deltas.set(key, existing)
  }

  let rolledUp = 0
  if (deltas.size > 0) {
    const orgIds = [...new Set([...deltas.values()].map((d) => d.org_id))]
    const { data: existingTotals } = await admin
      .from('task_archived_totals')
      .select('org_id, assigned_to, original_due_date, completed, completed_late')
      .in('org_id', orgIds)

    const existingByKey = new Map((existingTotals || []).map((r) => [`${r.org_id}|${r.assigned_to}|${r.original_due_date}`, r]))

    const upsertRows = [...deltas.entries()].map(([key, d]) => {
      const prior = existingByKey.get(key)
      return {
        org_id: d.org_id,
        assigned_to: d.assigned_to,
        original_due_date: d.original_due_date,
        completed: (prior?.completed || 0) + d.completed,
        completed_late: (prior?.completed_late || 0) + d.completed_late,
        updated_at: new Date().toISOString(),
      }
    })

    // Single cron invocation processes this serially, so read-then-write above can't race
    // against itself the way concurrent request handlers could.
    const { error } = await admin.from('task_archived_totals').upsert(upsertRows, { onConflict: 'org_id,assigned_to,original_due_date' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rolledUp = upsertRows.length
  }

  const ids = eligible.map((t) => t.id)
  const { error: deleteError } = await admin.from('tasks').delete().in('id', ids)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  return NextResponse.json({ deleted: ids.length, rolledUp })
}
