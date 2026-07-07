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

function monthKeyBounds(y: number, m: number) {
  // m is 1-indexed
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const next = new Date(y, m, 1)
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  return { start, end }
}

// Profitability's date filter — the picked month plus the 5 before it, so the trend chart
// always ends on whatever month the per-client breakdown/bar chart below it is showing.
function trendWindow(pMonth: string) {
  const [y, m] = pMonth.split('-').map(Number)
  const monthKeys: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const [firstY, firstM] = monthKeys[0].split('-').map(Number)
  const { start } = monthKeyBounds(firstY, firstM)
  const { end } = monthKeyBounds(y, m)
  return { start, end, monthKeys }
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; pMonth?: string }> }) {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  // Reports is admin/owner only — members' tasks/time_entries RLS only exposes their own rows,
  // so an org-wide per-client report would be misleadingly incomplete for a member. Same
  // reasoning as the Team/Revenue gates.
  if (!isAdminRole(role)) redirect('/dashboard')

  const { range: rangeParam, pMonth: pMonthParam } = await searchParams
  const range: ReportRange = rangeParam === 'last_week' || rangeParam === 'this_month' ? rangeParam : 'this_week'
  const { start, end } = rangeBounds(range)

  // Capacity is always calendar-week, independent of the "by client" range picker above —
  // "who's overloaded" means this week regardless of what range the activity table is set to.
  const weekAnchor = getWeekAnchor()
  const weekEnd = todayKey(new Date(new Date(weekAnchor).getTime() + 7 * 86400000))

  // Profitability has its own month picker (defaults to the current month) — the trend chart
  // covers that month plus the 5 before it, so monthTimeEntries/monthPaidInvoices below span
  // that whole 6-month window rather than just "this month".
  const now = new Date()
  const pMonth = /^\d{4}-\d{2}$/.test(pMonthParam ?? '') ? (pMonthParam as string) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const { start: trendStart, end: trendEnd, monthKeys } = trendWindow(pMonth)

  const [
    { data: clients },
    { data: tasks },
    { data: entries },
    { data: members },
    { data: reports },
    { data: openTasks },
    { data: weekTimeEntries },
    { data: monthTimeEntries },
    { data: monthPaidInvoices },
  ] = await Promise.all([
    supabase.from('clients').select('id, name, retainer_cents').eq('org_id', orgId).order('name'),
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
    supabase
      .from('org_members')
      .select('user_id, invited_email, display_name, avatar_url, target_hours_per_week')
      .eq('org_id', orgId)
      .eq('status', 'active'),
    supabase.from('reports').select('period_type, period_start, content').eq('org_id', orgId).order('period_start', { ascending: false }),
    supabase.from('tasks').select('id, assigned_to').eq('org_id', orgId).eq('done', false),
    supabase
      .from('time_entries')
      .select('user_id, duration_seconds')
      .eq('org_id', orgId)
      .not('duration_seconds', 'is', null)
      .gte('started_at', weekAnchor)
      .lt('started_at', weekEnd),
    supabase
      .from('time_entries')
      .select('client_id, duration_seconds, started_at')
      .eq('org_id', orgId)
      .not('duration_seconds', 'is', null)
      .gte('started_at', trendStart)
      .lt('started_at', trendEnd),
    supabase
      .from('invoices')
      .select('client_id, amount_cents, paid_at')
      .eq('org_id', orgId)
      .eq('status', 'paid')
      .gte('paid_at', trendStart)
      .lt('paid_at', trendEnd),
  ])

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
        openTasks={openTasks ?? []}
        weekTimeEntries={weekTimeEntries ?? []}
        monthTimeEntries={monthTimeEntries ?? []}
        monthPaidInvoices={monthPaidInvoices ?? []}
        targetRateCents={org?.settings?.hourly_cost_cents ?? 0}
        pMonth={pMonth}
        trendMonthKeys={monthKeys}
      />
    </AppShell>
  )
}
