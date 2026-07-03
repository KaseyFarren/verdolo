import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import TimeClient from './TimeClient'

export default async function TimePage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  const [{ data: clients }, { data: tasks }, { data: entries }, { data: members }, { data: archivedTotals }] = await Promise.all([
    supabase.from('clients').select('id, name').eq('org_id', orgId).order('name'),
    supabase.from('tasks').select('id, title, client_id').eq('org_id', orgId).eq('done', false),
    supabase
      .from('time_entries')
      .select('*')
      .eq('org_id', orgId)
      .order('started_at', { ascending: false })
      .limit(100),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url, role, title').eq('org_id', orgId).eq('status', 'active'),
    supabase.from('time_archived_totals').select('client_id, user_id, seconds').eq('org_id', orgId),
  ])

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <TimeClient
        orgId={orgId}
        userId={user.id}
        isAdmin={isAdminRole(role)}
        clients={clients ?? []}
        tasks={tasks ?? []}
        initialEntries={entries ?? []}
        members={members ?? []}
        archivedTotals={archivedTotals ?? []}
      />
    </AppShell>
  )
}
