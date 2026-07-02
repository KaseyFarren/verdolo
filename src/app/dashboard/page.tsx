import AppShell from '@/components/AppShell'
import { requireOrgContext } from '@/lib/org'
import { getOrgAnthropicKey } from '@/lib/orgSecrets'
import { getOffsetDate, stripRetainer } from '@/lib/agency'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  const weekStart = getOffsetDate(-7)
  const [{ data: clients }, { data: tasks }, { data: recurring }, { data: timeEntries }, apiKey] = await Promise.all([
    supabase.from('clients').select('*').eq('org_id', orgId).order('name'),
    supabase.from('tasks').select('*').eq('org_id', orgId),
    supabase.from('recurring_templates').select('*').eq('org_id', orgId),
    supabase
      .from('time_entries')
      .select('client_id, duration_seconds')
      .eq('org_id', orgId)
      .not('duration_seconds', 'is', null)
      .gte('started_at', weekStart),
    getOrgAnthropicKey(orgId),
  ])

  // MRR is revenue — only owners see it, so admins/members never even receive the retainer figures
  const visibleClients = role === 'owner' ? clients ?? [] : stripRetainer(clients ?? [])

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <DashboardClient
        orgId={orgId}
        userId={user.id}
        initialClients={visibleClients}
        initialTasks={tasks ?? []}
        initialRecurring={recurring ?? []}
        weekTimeEntries={timeEntries ?? []}
        hasApiKey={!!apiKey}
        excludeWeekends={org?.settings?.exclude_weekends ?? true}
      />
    </AppShell>
  )
}
