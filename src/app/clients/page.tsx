import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import { stripRetainer } from '@/lib/agency'
import ClientsClient from './ClientsClient'

export default async function ClientsPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()
  const canEdit = isAdminRole(role)

  const [
    { data: clients },
    { data: notes },
    { data: tasks },
    { data: aiMessages },
    { data: timeEntries },
    { data: archivedTimeTotals },
    { data: members },
    { data: invoices },
    { data: unbilledCharges },
    { data: healthSnapshots },
  ] = await Promise.all([
    supabase.from('clients').select('*').eq('org_id', orgId).order('name'),
    supabase.from('client_notes').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
    supabase.from('tasks').select('*').eq('org_id', orgId).eq('done', true).not('completed_at', 'is', null),
    supabase.from('ai_message_log').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    supabase.from('time_entries').select('client_id, duration_seconds').eq('org_id', orgId).not('duration_seconds', 'is', null),
    supabase.from('time_archived_totals').select('client_id, seconds').eq('org_id', orgId),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url').eq('org_id', orgId).eq('status', 'active'),
    canEdit ? supabase.from('invoices').select('*').eq('org_id', orgId).order('sent_at', { ascending: false }) : Promise.resolve({ data: [] }),
    canEdit
      ? supabase.from('client_charges').select('*').eq('org_id', orgId).is('invoice_id', null).order('charged_on', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from('client_health_snapshots')
      .select('client_id, snapshot_date, health')
      .eq('org_id', orgId)
      .gte('snapshot_date', new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10))
      .order('snapshot_date', { ascending: true }),
  ])

  // retainer amounts are revenue — members (view-only on clients) don't get them, admins/owners do
  const visibleClients = canEdit ? clients ?? [] : stripRetainer(clients ?? [])

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <ClientsClient
        orgId={orgId}
        userId={user.id}
        canEdit={canEdit}
        initialClients={visibleClients}
        initialNotes={notes ?? []}
        completedTasks={tasks ?? []}
        aiMessages={aiMessages ?? []}
        timeEntries={timeEntries ?? []}
        archivedTimeTotals={archivedTimeTotals ?? []}
        members={members ?? []}
        invoices={invoices ?? []}
        unbilledCharges={unbilledCharges ?? []}
        healthSnapshots={healthSnapshots ?? []}
        stripeConnectStatus={org?.stripe_connect_status ?? 'not_connected'}
      />
    </AppShell>
  )
}
