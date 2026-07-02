import AppShell from '@/components/AppShell'
import { requireOrgContext } from '@/lib/org'
import CalendarClient from './CalendarClient'

export default async function CalendarPage() {
  const { supabase, user, orgId, org } = await requireOrgContext()

  const [{ data: clients }, { data: tasks }] = await Promise.all([
    supabase.from('clients').select('id, name').eq('org_id', orgId).order('name'),
    supabase.from('tasks').select('*').eq('org_id', orgId).order('due_date'),
  ])

  return (
    <AppShell orgName={org?.name ?? ''} userEmail={user.email ?? ''}>
      <CalendarClient orgId={orgId} initialClients={clients ?? []} initialTasks={tasks ?? []} />
    </AppShell>
  )
}
