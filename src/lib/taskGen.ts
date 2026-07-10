import type { SupabaseClient } from '@supabase/supabase-js'
import { getOffsetDate, getStage, isWeekend, recurringMatchesDate, todayKey } from '@/lib/agency'

type Client = { id: string; stage?: string | null; status?: string | null }
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
type DefaultTemplate = {
  id: string
  title: string
  priority?: string | null
  notes?: string | null
  assigned_to?: string | null
  auto_type?: string | null
  paused?: boolean
}

/** Idempotent and safe to call concurrently (e.g. from Dashboard and Tasks mounting at once):
 * duplicate default-task / recurring instances are prevented by DB-level unique constraints
 * (tasks_default_template_instance_unique, tasks_recurring_instance_unique), so upserting with
 * ignoreDuplicates can't race regardless of how many callers run at the same time.
 *
 * Returns the rows actually inserted (PostgREST only returns rows that weren't skipped by
 * ON CONFLICT DO NOTHING), so callers can merge just the new tasks into state instead of
 * re-fetching the entire active-tasks table on every mount. */
export async function ensureAutoAndRecurringTasks(
  supabase: SupabaseClient,
  orgId: string,
  clients: Client[],
  recurring: RecurringTemplate[],
  defaultTemplates: DefaultTemplate[],
  excludeWeekends: boolean
): Promise<Record<string, unknown>[]> {
  const today = todayKey()
  const tomorrow = getOffsetDate(1)
  const dates = [today, tomorrow].filter((d) => !excludeWeekends || !isWeekend(d))
  if (!dates.length) return []

  const defaultRows: Record<string, unknown>[] = []
  const recurringRows: Record<string, unknown>[] = []

  for (const date of dates) {
    for (const c of clients) {
      if (getStage(c) === 'Churned') continue
      for (const d of defaultTemplates) {
        if (d.paused) continue
        defaultRows.push({
          org_id: orgId,
          client_id: c.id,
          assigned_to: d.assigned_to || null,
          title: d.title,
          due_date: date,
          priority: d.priority || 'Medium',
          notes: d.notes || '',
          done: false,
          is_auto: true,
          auto_type: d.auto_type || null,
          default_template_id: d.id,
        })
      }
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

  const newRows: Record<string, unknown>[] = []
  if (defaultRows.length) {
    const { data } = await supabase
      .from('tasks')
      .upsert(defaultRows, { onConflict: 'org_id,client_id,due_date,default_template_id', ignoreDuplicates: true })
      .select()
    if (data) newRows.push(...data)
  }
  if (recurringRows.length) {
    const { data } = await supabase
      .from('tasks')
      .upsert(recurringRows, { onConflict: 'org_id,recurring_id,due_date', ignoreDuplicates: true })
      .select()
    if (data) newRows.push(...data)
  }
  return newRows
}
