import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import { stripRetainer } from '@/lib/agency'
import TasksClient from './TasksClient'

export default async function TasksPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  const [{ data: clients }, { data: tasks }, { data: recurring }, { data: defaults }, { data: members }] = await Promise.all([
    supabase.from('clients').select('*').eq('org_id', orgId).order('name'),
    supabase.from('tasks').select('*').eq('org_id', orgId).order('due_date'),
    supabase.from('recurring_templates').select('*').eq('org_id', orgId).order('created_at'),
    supabase.from('default_task_templates').select('*').eq('org_id', orgId).order('created_at'),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url').eq('org_id', orgId).eq('status', 'active'),
  ])

  const visibleClients = isAdminRole(role) ? clients ?? [] : stripRetainer(clients ?? [])

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <TasksClient
        orgId={orgId}
        userId={user.id}
        isAdmin={isAdminRole(role)}
        initialClients={visibleClients}
        initialTasks={tasks ?? []}
        initialRecurring={recurring ?? []}
        initialDefaults={defaults ?? []}
        members={members ?? []}
        excludeWeekends={org?.settings?.exclude_weekends ?? true}
      />
    </AppShell>
  )
}
