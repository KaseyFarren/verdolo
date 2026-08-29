import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import { getWeekAnchor, todayKey } from '@/lib/agency'
import { periodBounds, type Period } from '@/lib/period'
import ReportsClient from './ReportsClient'

export const REPORT_RANGE_PRESETS: Period[] = ['this_week', 'last_week', 'this_month', 'last_month', 'custom']

function monthKeyBounds(y: number, m: number) {
  // m is 1-indexed
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const next = new Date(y, m, 1)
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  return { start, end }
}

// Profitability's date filter - the picked month plus the 11 before it, so the trend chart
// always ends on whatever month the per-client breakdown/bar chart below it is showing. 12
// months is a superset wide enough for the client to bucket into either a 12-month trend or
// up to a 52-week trend without a second server round trip when the granularity toggle changes.
function trendWindow(pMonth: string) {
  const [y, m] = pMonth.split('-').map(Number)
  const monthKeys: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const [firstY, firstM] = monthKeys[0].split('-').map(Number)
  const { start } = monthKeyBounds(firstY, firstM)
  const { end } = monthKeyBounds(y, m)
  return { start, end, monthKeys }
}

// Reports has no realtime subscription and its data is inherently historical (completed tasks,
// past time entries), so a short cache window is safe here in a way it isn't for
// Tasks/Messages/Clients/Revenue/Proposals. unstable_cache results are shared across whichever
// request produces a cache miss, so this can't use the caller's RLS-scoped client (that would
// serve one admin's personalized query result to every other admin/owner of the org for up to
// 60s). Instead it uses the service-role client and re-implements the authorization filter
// explicitly: every query below is scoped with .eq('org_id', orgId), and the page itself already
// gates entry on isAdminRole(role) before this is ever called, so org_id scoping is the complete
// authorization check for this data.
function getCachedReportsData(orgId: string, keyParts: string[]) {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      const [
        { data: clients },
        { data: tasks },
        { data: entries },
        { data: members },
        { data: reports },
        { data: openTasks },
        { data: weekTimeEntries },
        { data: monthTimeEntries },
        { data: monthClientCharges },
      ] = await Promise.all([
        supabase
          .from('clients')
          .select('id, name, retainer_cents, billing_mode, hourly_rate_cents, billing_day, stage, status, last_contacted, cadence_days, added_date, paused_at')
          .eq('org_id', orgId)
          .order('name'),
        supabase
          .from('tasks')
          .select('id, client_id, assigned_to, title, completed_at')
          .eq('org_id', orgId)
          .eq('done', true)
          .gte('completed_at', keyParts[0])
          .lt('completed_at', keyParts[1]),
        supabase
          .from('time_entries')
          .select('client_id, user_id, duration_seconds')
          .eq('org_id', orgId)
          .not('duration_seconds', 'is', null)
          .gte('started_at', keyParts[0])
          .lt('started_at', keyParts[1]),
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
          .gte('started_at', keyParts[2])
          .lt('started_at', keyParts[3]),
        supabase
          .from('time_entries')
          .select('client_id, duration_seconds, started_at, billable')
          .eq('org_id', orgId)
          .not('duration_seconds', 'is', null)
          .gte('started_at', keyParts[4])
          .lt('started_at', keyParts[5]),
        supabase
          .from('client_charges')
          .select('client_id, amount_cents, charged_on')
          .eq('org_id', orgId)
          .gte('charged_on', keyParts[4])
          .lt('charged_on', keyParts[5]),
      ])

      return { clients, tasks, entries, members, reports, openTasks, weekTimeEntries, monthTimeEntries, monthClientCharges }
    },
    ['reports', orgId, ...keyParts],
    { revalidate: 60, tags: [`reports:${orgId}`] }
  )()
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; start?: string; end?: string; pMonth?: string }>
}) {
  const { orgId, role, org } = await requireOrgContext()

  // Reports is admin/owner only - members' tasks/time_entries RLS only exposes their own rows,
  // so an org-wide per-client report would be misleadingly incomplete for a member. Same
  // reasoning as the Team/Revenue gates.
  if (!isAdminRole(role)) redirect('/dashboard')

  const { range: rangeParam, start: rangeStartParam, end: rangeEndParam, pMonth: pMonthParam } = await searchParams
  const range: Period = REPORT_RANGE_PRESETS.includes(rangeParam as Period) ? (rangeParam as Period) : 'this_week'
  const { start, end } = periodBounds({ period: range, start: rangeStartParam, end: rangeEndParam }) as { start: string; end: string }

  // Capacity is always calendar-week, independent of the "by client" range picker above -
  // "who's overloaded" means this week regardless of what range the activity table is set to.
  const weekAnchor = getWeekAnchor()
  const weekEnd = todayKey(new Date(new Date(weekAnchor).getTime() + 7 * 86400000))

  // Profitability has its own month picker (defaults to the current month) - the trend chart
  // covers that month plus the 5 before it, so monthTimeEntries below spans that whole
  // 6-month window rather than just "this month".
  const now = new Date()
  const pMonth = /^\d{4}-\d{2}$/.test(pMonthParam ?? '') ? (pMonthParam as string) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const { start: trendStart, end: trendEnd, monthKeys } = trendWindow(pMonth)

  const { clients, tasks, entries, members, reports, openTasks, weekTimeEntries, monthTimeEntries, monthClientCharges } = await getCachedReportsData(
    orgId,
    [start, end, weekAnchor, weekEnd, trendStart, trendEnd]
  )

  return (
    <ReportsClient
      orgId={orgId}
      range={{ period: range, start: rangeStartParam, end: rangeEndParam }}
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
      monthClientCharges={monthClientCharges ?? []}
      targetRateCents={org?.settings?.hourly_cost_cents ?? 0}
      pMonth={pMonth}
      trendMonthKeys={monthKeys}
      currency={org?.settings?.currency ?? 'usd'}
    />
  )
}
