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
type TemplateSubtask = { id: string; template_id: string; title: string }

/** Idempotent and safe to call concurrently (e.g. from Dashboard and Tasks mounting at once):
 * duplicate default-task / recurring instances are prevented by DB-level unique constraints
 * (tasks_default_template_instance_unique, tasks_recurring_instance_unique), so upserting with
 * ignoreDuplicates can't race regardless of how many callers run at the same time. Any subtasks
 * configured on those templates are generated right after, deduped the same way via
 * tasks_generated_subtask_unique.
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

  const childRows = await generateTemplateSubtasks(supabase, newRows)
  newRows.push(...childRows)

  return newRows
}

/** For each newly-created default/recurring instance in `newRows`, looks up that template's
 * configured subtasks (default_task_template_subtasks / recurring_template_subtasks) and creates
 * one child task per subtask, parented to the fresh instance. Only runs against instances that
 * were actually just inserted (not skipped as duplicates), so a template's subtasks are only
 * ever generated once per instance - the tasks_generated_subtask_unique constraint is a backstop
 * against re-running this concurrently, not the primary dedupe mechanism. */
async function generateTemplateSubtasks(supabase: SupabaseClient, newRows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const defaultParents = newRows.filter((r) => r.default_template_id)
  const recurringParents = newRows.filter((r) => r.recurring_id)
  if (!defaultParents.length && !recurringParents.length) return []

  const childRows: Record<string, unknown>[] = []

  if (defaultParents.length) {
    const templateIds = [...new Set(defaultParents.map((r) => r.default_template_id as string))]
    const { data: subs } = await supabase.from('default_task_template_subtasks').select('id, template_id, title').in('template_id', templateIds)
    for (const parent of defaultParents) {
      for (const st of ((subs as TemplateSubtask[]) || []).filter((s) => s.template_id === parent.default_template_id)) {
        childRows.push(buildChildRow(parent, st))
      }
    }
  }

  if (recurringParents.length) {
    const templateIds = [...new Set(recurringParents.map((r) => r.recurring_id as string))]
    const { data: subs } = await supabase.from('recurring_template_subtasks').select('id, template_id, title').in('template_id', templateIds)
    for (const parent of recurringParents) {
      for (const st of ((subs as TemplateSubtask[]) || []).filter((s) => s.template_id === parent.recurring_id)) {
        childRows.push(buildChildRow(parent, st))
      }
    }
  }

  if (!childRows.length) return []
  const { data } = await supabase.from('tasks').upsert(childRows, { onConflict: 'parent_task_id,template_subtask_id', ignoreDuplicates: true }).select()
  return data || []
}

// recurring_id / default_template_id are deliberately NOT copied onto the child row: those
// columns back tasks_recurring_instance_unique / tasks_default_template_instance_unique, which
// key on (org_id, recurring_id|default_template_id, due_date) alone - every subtask under the
// same parent would collide on that constraint. Dedup for children instead runs entirely off
// tasks_generated_subtask_unique (parent_task_id, template_subtask_id). is_auto IS copied from
// the parent since it's what the "Default" vs "Recurring" Type badge and notification-sound
// suppression key off, and neither of those touches the two constraints above.
function buildChildRow(parent: Record<string, unknown>, subtask: TemplateSubtask) {
  const assignedTo = (parent.assigned_to as string | null) || null
  return {
    org_id: parent.org_id,
    client_id: parent.client_id,
    assigned_to: assignedTo,
    assignee_ids: assignedTo ? [assignedTo] : [],
    title: subtask.title,
    due_date: parent.due_date,
    priority: 'Medium',
    notes: '',
    done: false,
    is_auto: !!parent.is_auto,
    parent_task_id: parent.id,
    template_subtask_id: subtask.id,
  }
}
