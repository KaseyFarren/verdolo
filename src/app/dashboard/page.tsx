import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import { getOffsetDate, getWeekAnchor, todayKey } from '@/lib/agency'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  const weekAnchor = getWeekAnchor()
  const today = todayKey()
  const tomorrow = getOffsetDate(1)
  const [
    { data: clients },
    { data: tasks },
    { data: recurring },
    { data: defaults },
    { data: todayTimeEntries },
    { data: weekTimeEntries },
    { data: members },
    { data: noteRow },
    { data: reports },
    { data: sentTodayRows },
  ] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, business, platform, stage, status, contract_ends, tone, awaiting_reply, primary_contact_id')
      .eq('org_id', orgId)
      .order('name'),
    supabase.from('tasks').select('*').eq('org_id', orgId).eq('archived', false),
    supabase.from('recurring_templates').select('*').eq('org_id', orgId),
    supabase.from('default_task_templates').select('*').eq('org_id', orgId),
    // RLS scopes this for free: admins/owners get every member's rows, members only get their own.
    supabase
      .from('time_entries')
      .select('user_id, client_id, duration_seconds')
      .eq('org_id', orgId)
      .not('duration_seconds', 'is', null)
      .gte('started_at', `${today}T00:00:00`)
      .lt('started_at', `${tomorrow}T00:00:00`),
    // Powers the Dashboard's "This week" team highlight card.
    supabase
      .from('time_entries')
      .select('user_id, duration_seconds')
      .eq('org_id', orgId)
      .not('duration_seconds', 'is', null)
      .gte('started_at', `${weekAnchor}T00:00:00`)
      .lt('started_at', `${tomorrow}T00:00:00`),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url').eq('org_id', orgId).eq('status', 'active'),
    supabase.from('quick_notes').select('content').eq('org_id', orgId).eq('user_id', user.id).maybeSingle(),
    supabase
      .from('reports')
      .select('period_start, content')
      .eq('org_id', orgId)
      .eq('period_type', 'week')
      .order('period_start', { ascending: false })
      .limit(8),
    // Drives the client-messages "✓ Sent" state directly from the actual send log, rather than
    // from a same-day auto-checkin task existing/being done - that task can lag or be missing
    // (e.g. right after mount), which made "Copy & mark sent" look like it did nothing.
    supabase.from('ai_message_log').select('client_id').eq('org_id', orgId).gte('created_at', `${today}T00:00:00`).lt('created_at', `${tomorrow}T00:00:00`),
  ])

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <DashboardClient
        orgId={orgId}
        userId={user.id}
        isAdmin={isAdminRole(role)}
        initialClients={clients ?? []}
        initialTasks={tasks ?? []}
        initialRecurring={recurring ?? []}
        initialDefaults={defaults ?? []}
        todayTimeEntries={todayTimeEntries ?? []}
        weekTimeEntries={weekTimeEntries ?? []}
        members={members ?? []}
        initialNote={noteRow?.content ?? ''}
        hasApiKey={!!process.env.ANTHROPIC_API_KEY}
        excludeWeekends={org?.settings?.exclude_weekends ?? true}
        hasRecapThisWeek={!!reports?.some((r) => r.period_start === weekAnchor)}
        initialSentToday={[...new Set((sentTodayRows ?? []).map((r) => r.client_id).filter((id): id is string => !!id))]}
      />
    </AppShell>
  )
}
