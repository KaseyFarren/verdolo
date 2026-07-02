import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import { stripRetainer } from '@/lib/agency'
import ClientsClient from './ClientsClient'

export default async function ClientsPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()
  const canEdit = isAdminRole(role)

  const [{ data: clients }, { data: notes }, { data: tasks }, { data: aiMessages }, { data: timeEntries }] = await Promise.all([
    supabase.from('clients').select('*').eq('org_id', orgId).order('name'),
    supabase.from('client_notes').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
    supabase.from('tasks').select('*').eq('org_id', orgId).eq('done', true).not('completed_at', 'is', null),
    supabase.from('ai_message_log').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    supabase.from('time_entries').select('client_id, duration_seconds').eq('org_id', orgId).not('duration_seconds', 'is', null),
  ])

  // retainer amounts are revenue — members (view-only on clients) don't get them, admins/owners do
  const visibleClients = canEdit ? clients ?? [] : stripRetainer(clients ?? [])

  return (
    <AppShell orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role}>
      <ClientsClient
        orgId={orgId}
        userId={user.id}
        canEdit={canEdit}
        initialClients={visibleClients}
        initialNotes={notes ?? []}
        completedTasks={tasks ?? []}
        aiMessages={aiMessages ?? []}
        timeEntries={timeEntries ?? []}
      />
    </AppShell>
  )
}
