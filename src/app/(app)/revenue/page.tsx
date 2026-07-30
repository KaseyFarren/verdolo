import { redirect } from 'next/navigation'
import { requireOrgContext } from '@/lib/org'
import { getOffsetDate, todayKey } from '@/lib/agency'
import { periodBounds, type Period } from '@/lib/period'
import RevenueClient from './RevenueClient'

const VALID_PERIODS: Period[] = ['this_month', 'last_month', 'this_week', 'last_week', 'custom']

export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ period?: string; start?: string; end?: string }> }) {
  const { supabase, orgId, role, org } = await requireOrgContext()

  // revenue is owner-only - redirect server-side before any revenue data is fetched, rather
  // than relying on a client-side check (Server Component props still serialize to the client
  // regardless of what's rendered, same reasoning as stripBillingInfo() in lib/agency.ts)
  if (role !== 'owner') redirect('/dashboard')

  const sp = await searchParams
  const period: Period = VALID_PERIODS.includes(sp.period as Period) ? (sp.period as Period) : 'this_month'
  const bounds = periodBounds({ period, start: sp.start, end: sp.end })
  // 'all_time' isn't in VALID_PERIODS above, so bounds is always concrete here
  const rangeStart = bounds.start as string
  const rangeEnd = bounds.end as string

  const [{ data: clients }, { data: charges }, { data: entries }, { data: members }, { data: tasks }, { data: archivedTaskTotals }, { data: cycleEntries }] =
    await Promise.all([
      supabase
        .from('clients')
        .select('id, name, retainer_cents, retainer_hours, billing_mode, hourly_rate_cents, billing_day, stage, status')
        .eq('org_id', orgId)
        .order('name'),
      supabase
        .from('client_charges')
        .select('*')
        .eq('org_id', orgId)
        .gte('charged_on', rangeStart)
        .lt('charged_on', rangeEnd)
        .order('charged_on', { ascending: false }),
      supabase
        .from('time_entries')
        .select('id, user_id, client_id, duration_seconds, started_at, billable')
        .eq('org_id', orgId)
        .gte('started_at', rangeStart)
        .lt('started_at', rangeEnd),
      supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url, role, title').eq('org_id', orgId).eq('status', 'active'),
      // original_due_date is frozen at creation (see migration 0020) so this can't be gamed by
      // pushing due_date forward - completed/overdue/late counters always reflect the original commitment
      supabase
        .from('tasks')
        .select('assigned_to, done, completed_at, original_due_date')
        .eq('org_id', orgId)
        .not('assigned_to', 'is', null)
        .gte('original_due_date', rangeStart)
        .lt('original_due_date', rangeEnd),
      // Rolled-up counts for tasks the archive-cleanup cron already hard-deleted (60+ days
      // after archiving) - see migration 0048. Folds back into the same completed/completed-late
      // counters below so old custom date ranges don't drop to zero once the rows are gone.
      supabase
        .from('task_archived_totals')
        .select('assigned_to, completed, completed_late')
        .eq('org_id', orgId)
        .gte('original_due_date', rangeStart)
        .lt('original_due_date', rangeEnd),
      // Deliberately separate from `entries` above (bounded to the selected period's calendar
      // range) - burn is scoped to each retainer client's own billing cycle, which for a
      // mid-month billing_day doesn't align with a calendar-month range. 62 days covers any
      // billing_day's current cycle in any calendar month.
      supabase
        .from('time_entries')
        .select('client_id, task_id, duration_seconds, started_at')
        .eq('org_id', orgId)
        .not('duration_seconds', 'is', null)
        .gte('started_at', `${getOffsetDate(-62)}T00:00:00`),
    ])

  // Burn-driver titles: resolved only for the tasks that actually appear in cycleEntries, not
  // the whole org's task list.
  const cycleTaskIds = [...new Set((cycleEntries ?? []).map((e) => e.task_id).filter((id): id is string => !!id))]
  const { data: cycleTasks } = cycleTaskIds.length
    ? await supabase.from('tasks').select('id, title').eq('org_id', orgId).in('id', cycleTaskIds)
    : { data: [] }
  const taskTitles = Object.fromEntries((cycleTasks ?? []).map((t) => [t.id, t.title]))

  return (
    <RevenueClient
      orgId={orgId}
      period={{ period, start: sp.start, end: sp.end }}
      today={todayKey()}
      clients={clients ?? []}
      initialCharges={charges ?? []}
      entries={entries ?? []}
      members={members ?? []}
      tasks={tasks ?? []}
      archivedTaskTotals={archivedTaskTotals ?? []}
      cycleEntries={cycleEntries ?? []}
      taskTitles={taskTitles}
      targetRateCents={org?.settings?.hourly_cost_cents ?? 0}
      currency={org?.settings?.currency ?? 'usd'}
    />
  )
}
