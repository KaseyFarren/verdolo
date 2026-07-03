import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import { getOrgAnthropicKey } from '@/lib/orgSecrets'
import { getOffsetDate, stripRetainer, todayKey } from '@/lib/agency'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  const weekStart = getOffsetDate(-7)
  const today = todayKey()
  const tomorrow = getOffsetDate(1)
  const [{ data: clients }, { data: tasks }, { data: recurring }, { data: timeEntries }, { data: todayTimeEntries }, { data: members }, { data: noteRow }, apiKey] =
    await Promise.all([
      supabase.from('clients').select('*').eq('org_id', orgId).order('name'),
      supabase.from('tasks').select('*').eq('org_id', orgId),
      supabase.from('recurring_templates').select('*').eq('org_id', orgId),
      supabase
        .from('time_entries')
        .select('client_id, duration_seconds')
        .eq('org_id', orgId)
        .not('duration_seconds', 'is', null)
        .gte('started_at', weekStart),
      // RLS scopes this for free: admins/owners get every member's rows, members only get their own.
      supabase
        .from('time_entries')
        .select('user_id, client_id, duration_seconds')
        .eq('org_id', orgId)
        .not('duration_seconds', 'is', null)
        .gte('started_at', `${today}T00:00:00`)
        .lt('started_at', `${tomorrow}T00:00:00`),
      supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url').eq('org_id', orgId).eq('status', 'active'),
      supabase.from('quick_notes').select('content').eq('org_id', orgId).eq('user_id', user.id).maybeSingle(),
      getOrgAnthropicKey(orgId),
    ])

  // MRR is revenue — only owners see it, so admins/members never even receive the retainer figures
  const visibleClients = role === 'owner' ? clients ?? [] : stripRetainer(clients ?? [])

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <DashboardClient
        orgId={orgId}
        userId={user.id}
        isAdmin={isAdminRole(role)}
        initialClients={visibleClients}
        initialTasks={tasks ?? []}
        initialRecurring={recurring ?? []}
        weekTimeEntries={timeEntries ?? []}
        todayTimeEntries={todayTimeEntries ?? []}
        members={members ?? []}
        initialNote={noteRow?.content ?? ''}
        hasApiKey={!!apiKey}
        excludeWeekends={org?.settings?.exclude_weekends ?? true}
      />
    </AppShell>
  )
}
