import { isAdminRole, requireOrgContext } from '@/lib/org'
import { stripBillingInfo } from '@/lib/agency'
import TasksClient from './TasksClient'

export default async function TasksPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  // .limit(2000) is a defensive ceiling against pathological growth, not user-facing pagination.
  // The active-tasks query is intentionally left unbounded - date bucketing needs the true full
  // active set, and is now covered by idx_tasks_active (supabase/migrations/0047).
  const [{ data: clients }, { data: tasks }, { data: recurring }, { data: defaults }, { data: members }, { data: budgets }] = await Promise.all([
    supabase.from('clients').select('*').eq('org_id', orgId).order('name').limit(2000),
    supabase.from('tasks').select('*').eq('org_id', orgId).eq('archived', false).order('due_date'),
    supabase.from('recurring_templates').select('*').eq('org_id', orgId).order('created_at').limit(2000),
    supabase.from('default_task_templates').select('*').eq('org_id', orgId).order('created_at').limit(2000),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url').eq('org_id', orgId).eq('status', 'active'),
    // Admin-only via RLS (budgets_select is is_org_admin) - a non-admin's query just comes back empty.
    supabase.from('budgets').select('id, client_id, name').eq('org_id', orgId).eq('status', 'active').order('name'),
  ])

  const visibleClients = isAdminRole(role) ? clients ?? [] : stripBillingInfo(clients ?? [])

  const defaultTemplateIds = (defaults ?? []).map((d) => d.id)
  const recurringTemplateIds = (recurring ?? []).map((r) => r.id)
  const [{ data: defaultSubtasks }, { data: recurringSubtasks }] = await Promise.all([
    defaultTemplateIds.length
      ? supabase.from('default_task_template_subtasks').select('*').in('template_id', defaultTemplateIds).order('sort_order')
      : Promise.resolve({ data: [] }),
    recurringTemplateIds.length
      ? supabase.from('recurring_template_subtasks').select('*').in('template_id', recurringTemplateIds).order('sort_order')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <TasksClient
      orgId={orgId}
      userId={user.id}
      isAdmin={isAdminRole(role)}
      initialClients={visibleClients}
      initialTasks={tasks ?? []}
      initialRecurring={recurring ?? []}
      initialDefaults={defaults ?? []}
      initialDefaultSubtasks={defaultSubtasks ?? []}
      initialRecurringSubtasks={recurringSubtasks ?? []}
      members={members ?? []}
      budgets={budgets ?? []}
      excludeWeekends={org?.settings?.exclude_weekends ?? true}
    />
  )
}
