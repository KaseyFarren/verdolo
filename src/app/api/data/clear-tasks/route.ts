import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/apiError'

// "Clear all tasks" from settings > Data. Unlike "Reset all data" (which deletes clients and
// therefore cascade-wipes time logs, invoices, and charges), this only removes the tasks table
// so revenue records and time logs survive. Before deleting, it rolls every completed task into
// task_archived_totals - the same rollup the nightly purge cron uses (api/cron/archive-cleanup)
// so Revenue's completed/completed-late counters for old date ranges stay accurate once the rows
// are gone. task_archived_totals is admin-write-only (RLS is select-only), so this must run here
// rather than in the client.
export async function POST(request: Request) {
  const { orgId } = await request.json()
  if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (membership?.role !== 'admin' && membership?.role !== 'owner') {
    return NextResponse.json({ error: 'Only admins can clear tasks' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Only done tasks with both an assignee and an original_due_date feed Revenue's counters
  // (see revenue/page.tsx), so those are the only ones worth rolling up before deletion.
  const { data: completed, error: readError } = await admin
    .from('tasks')
    .select('assigned_to, completed_at, original_due_date')
    .eq('org_id', orgId)
    .eq('done', true)
    .not('assigned_to', 'is', null)
    .not('original_due_date', 'is', null)
  if (readError) return apiError('Could not read tasks', 500, readError)

  const deltas = new Map<string, { assigned_to: string; original_due_date: string; completed: number; completed_late: number }>()
  for (const t of completed || []) {
    const key = `${t.assigned_to}|${t.original_due_date}`
    const existing = deltas.get(key) || { assigned_to: t.assigned_to as string, original_due_date: t.original_due_date as string, completed: 0, completed_late: 0 }
    existing.completed += 1
    if (t.completed_at && t.completed_at.slice(0, 10) > t.original_due_date!) existing.completed_late += 1
    deltas.set(key, existing)
  }

  if (deltas.size > 0) {
    const { data: existingTotals } = await admin
      .from('task_archived_totals')
      .select('assigned_to, original_due_date, completed, completed_late')
      .eq('org_id', orgId)

    const existingByKey = new Map((existingTotals || []).map((r) => [`${r.assigned_to}|${r.original_due_date}`, r]))

    const upsertRows = [...deltas.entries()].map(([key, d]) => {
      const prior = existingByKey.get(key)
      return {
        org_id: orgId,
        assigned_to: d.assigned_to,
        original_due_date: d.original_due_date,
        completed: (prior?.completed || 0) + d.completed,
        completed_late: (prior?.completed_late || 0) + d.completed_late,
        updated_at: new Date().toISOString(),
      }
    })

    const { error: upsertError } = await admin.from('task_archived_totals').upsert(upsertRows, { onConflict: 'org_id,assigned_to,original_due_date' })
    if (upsertError) return apiError('Could not preserve task history', 500, upsertError)
  }

  const { error: deleteError } = await admin.from('tasks').delete().eq('org_id', orgId)
  if (deleteError) return apiError('Could not clear tasks', 500, deleteError)

  return NextResponse.json({ ok: true, rolledUp: deltas.size })
}
