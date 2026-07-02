import AppShell from '@/components/AppShell'
import { requireOrgContext } from '@/lib/org'
import ClientsClient from './ClientsClient'

export default async function ClientsPage() {
  const { supabase, user, orgId, org } = await requireOrgContext()

  const [{ data: clients }, { data: notes }, { data: tasks }, { data: aiMessages }, { data: timeEntries }] = await Promise.all([
    supabase.from('clients').select('*').eq('org_id', orgId).order('name'),
    supabase.from('client_notes').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
    supabase.from('tasks').select('*').eq('org_id', orgId).eq('done', true).not('completed_at', 'is', null),
    supabase.from('ai_message_log').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    supabase.from('time_entries').select('client_id, duration_seconds').eq('org_id', orgId).not('duration_seconds', 'is', null),
  ])

  return (
    <AppShell orgName={org?.name ?? ''} userEmail={user.email ?? ''}>
      <ClientsClient
        orgId={orgId}
        userId={user.id}
        initialClients={clients ?? []}
        initialNotes={notes ?? []}
        completedTasks={tasks ?? []}
        aiMessages={aiMessages ?? []}
        timeEntries={timeEntries ?? []}
      />
    </AppShell>
  )
}
