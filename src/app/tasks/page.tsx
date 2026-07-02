import AppShell from '@/components/AppShell'
import { requireOrgContext } from '@/lib/org'
import TasksClient from './TasksClient'

export default async function TasksPage() {
  const { supabase, user, orgId, org } = await requireOrgContext()

  const [{ data: clients }, { data: tasks }, { data: recurring }, { data: members }] = await Promise.all([
    supabase.from('clients').select('*').eq('org_id', orgId).order('name'),
    supabase.from('tasks').select('*').eq('org_id', orgId).order('due_date'),
    supabase.from('recurring_templates').select('*').eq('org_id', orgId).order('created_at'),
    supabase.from('org_members').select('user_id, invited_email').eq('org_id', orgId).eq('status', 'active'),
  ])

  return (
    <AppShell orgName={org?.name ?? ''} userEmail={user.email ?? ''}>
      <TasksClient
        orgId={orgId}
        userId={user.id}
        initialClients={clients ?? []}
        initialTasks={tasks ?? []}
        initialRecurring={recurring ?? []}
        members={members ?? []}
        excludeWeekends={org?.settings?.exclude_weekends ?? true}
      />
    </AppShell>
  )
}
