import { isAdminRole, requireOrgContext } from '@/lib/org'
import { stripBillingInfo } from '@/lib/agency'
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
    { data: healthSnapshots },
  ] = await Promise.all([
    // .limit(2000) below is a defensive ceiling against pathological growth (e.g. a runaway
    // automation bug), not user-facing pagination - see supabase/migrations plan notes. Realistic
    // per-org volume (clients, notes) for this product stays well under that.
    supabase.from('clients').select('*').eq('org_id', orgId).order('name').limit(2000),
    supabase.from('client_notes').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(2000),
    supabase.from('tasks').select('*').eq('org_id', orgId).eq('done', true).not('completed_at', 'is', null).limit(2000),
    supabase.from('ai_message_log').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    supabase.from('time_entries').select('client_id, duration_seconds').eq('org_id', orgId).not('duration_seconds', 'is', null).limit(2000),
    supabase.from('time_archived_totals').select('client_id, seconds').eq('org_id', orgId),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url').eq('org_id', orgId).eq('status', 'active'),
    supabase
      .from('client_health_snapshots')
      .select('client_id, snapshot_date, health')
      .eq('org_id', orgId)
      .gte('snapshot_date', new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10))
      .order('snapshot_date', { ascending: true }),
  ])

  // billing amounts are revenue - members (view-only on clients) don't get them, admins/owners do
  const visibleClients = canEdit ? clients ?? [] : stripBillingInfo(clients ?? [])

  return (
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
      healthSnapshots={healthSnapshots ?? []}
      currency={org?.settings?.currency ?? 'usd'}
    />
  )
}
