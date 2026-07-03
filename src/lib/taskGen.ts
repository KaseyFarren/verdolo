import type { SupabaseClient } from '@supabase/supabase-js'
import { getOffsetDate, getStage, isWeekend, recurringMatchesDate, todayKey } from '@/lib/agency'

type Client = { id: string; stage?: string | null; status?: string | null; primary_contact_id?: string | null }
type RecurringTemplate = {
  id: string
  title: string
  client_id?: string | null
  priority?: string | null
  frequency: string
  notes?: string | null
  assigned_to?: string | null
  paused?: boolean
}

/** Idempotent and safe to call concurrently (e.g. from Dashboard and Tasks mounting at once):
 * duplicate auto check-ins / recurring instances are prevented by DB-level unique constraints
 * (tasks_auto_checkin_unique, tasks_recurring_instance_unique), so upserting with
 * ignoreDuplicates can't race regardless of how many callers run at the same time. */
export async function ensureAutoAndRecurringTasks(
  supabase: SupabaseClient,
  orgId: string,
  clients: Client[],
  recurring: RecurringTemplate[],
  excludeWeekends: boolean
) {
  const today = todayKey()
  const tomorrow = getOffsetDate(1)
  const dates = [today, tomorrow].filter((d) => !excludeWeekends || !isWeekend(d))
  if (!dates.length) return

  const checkinRows: Record<string, unknown>[] = []
  const recurringRows: Record<string, unknown>[] = []

  for (const date of dates) {
    for (const c of clients) {
      if (getStage(c) === 'Churned') continue
      checkinRows.push({
        org_id: orgId,
        client_id: c.id,
        assigned_to: c.primary_contact_id || null,
        title: `Daily check-in`,
        due_date: date,
        priority: 'High',
        done: false,
        is_auto: true,
        auto_type: 'checkin',
      })
    }
    for (const r of recurring) {
      if (r.paused) continue
      if (!recurringMatchesDate(r.frequency, date)) continue
      recurringRows.push({
        org_id: orgId,
        client_id: r.client_id || null,
        assigned_to: r.assigned_to || null,
        title: r.title,
        due_date: date,
        priority: r.priority || 'Medium',
        notes: r.notes || '',
        done: false,
        recurring_id: r.id,
      })
    }
  }

  if (checkinRows.length) {
    await supabase.from('tasks').upsert(checkinRows, { onConflict: 'org_id,client_id,due_date,auto_type', ignoreDuplicates: true })
  }
  if (recurringRows.length) {
    await supabase.from('tasks').upsert(recurringRows, { onConflict: 'org_id,recurring_id,due_date', ignoreDuplicates: true })
  }
}
