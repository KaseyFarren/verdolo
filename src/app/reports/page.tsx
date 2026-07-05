import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import { getWeekAnchor, todayKey } from '@/lib/agency'
import ReportsClient from './ReportsClient'

export type ReportRange = 'this_week' | 'last_week' | 'this_month'

function rangeBounds(range: ReportRange) {
  if (range === 'this_month') {
    const now = new Date()
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`
    return { start, end }
  }
  const thisWeekStart = getWeekAnchor()
  if (range === 'last_week') {
    const start = getWeekAnchor(new Date(new Date(thisWeekStart).getTime() - 7 * 86400000))
    return { start, end: thisWeekStart }
  }
  // this_week
  const nextWeek = new Date(thisWeekStart)
  nextWeek.setDate(nextWeek.getDate() + 7)
  return { start: thisWeekStart, end: todayKey(nextWeek) }
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  // Reports is admin/owner only — members' tasks/time_entries RLS only exposes their own rows,
  // so an org-wide per-client report would be misleadingly incomplete for a member. Same
  // reasoning as the Team/Revenue gates.
  if (!isAdminRole(role)) redirect('/dashboard')

  const { range: rangeParam } = await searchParams
  const range: ReportRange = rangeParam === 'last_week' || rangeParam === 'this_month' ? rangeParam : 'this_week'
  const { start, end } = rangeBounds(range)

  const [{ data: clients }, { data: tasks }, { data: entries }, { data: members }, { data: reports }] = await Promise.all([
    supabase.from('clients').select('id, name').eq('org_id', orgId).order('name'),
    supabase
      .from('tasks')
      .select('id, client_id, assigned_to, title, completed_at')
      .eq('org_id', orgId)
      .eq('done', true)
      .gte('completed_at', start)
      .lt('completed_at', end),
    supabase
      .from('time_entries')
      .select('client_id, user_id, duration_seconds')
      .eq('org_id', orgId)
      .not('duration_seconds', 'is', null)
      .gte('started_at', start)
      .lt('started_at', end),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url').eq('org_id', orgId).eq('status', 'active'),
    supabase.from('weekly_reports').select('week_start, content').eq('org_id', orgId).order('week_start', { ascending: false }),
  ])

  const weekAnchor = getWeekAnchor()

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <ReportsClient
        orgId={orgId}
        range={range}
        clients={clients ?? []}
        tasks={tasks ?? []}
        entries={entries ?? []}
        members={members ?? []}
        reports={reports ?? []}
        weekAnchor={weekAnchor}
        hasApiKey={!!process.env.ANTHROPIC_API_KEY}
      />
    </AppShell>
  )
}
