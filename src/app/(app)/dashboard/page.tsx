import { isAdminRole, requireOrgContext } from '@/lib/org'
import { getOffsetDate, getWeekAnchor, mrrCentsTotal, todayKey } from '@/lib/agency'
import { billingCycleElapsedFraction, billingCycleProgress } from '@/lib/period'
import { computeClientBurn, type ClientBurn } from '@/lib/burn'
import DashboardClient from './DashboardClient'

// Retainer prorated by billing cycle + hourly billable hours × rate - same methodology as
// Reports' profitabilityForMonth, just summed to one number instead of broken out per client.
// Kept server-side only: billing rows (retainer_cents, hourly_rate_cents) never reach the
// client bundle for non-admin sessions.
function estimateMonthRevenueCents(
  billingClients: { id: string; retainer_cents: number | null; billing_mode: string | null; hourly_rate_cents: number | null; billing_day: number | null }[],
  entries: { client_id: string | null; duration_seconds: number | null; billable: boolean }[],
) {
  let total = 0
  for (const c of billingClients) {
    const clientEntries = entries.filter((e) => e.client_id === c.id)
    const isHourly = c.billing_mode === 'hourly'
    total += isHourly
      ? Math.round((clientEntries.filter((e) => e.billable).reduce((s, e) => s + (e.duration_seconds || 0), 0) / 3600) * (c.hourly_rate_cents || 0))
      : Math.round((c.retainer_cents || 0) * billingCycleElapsedFraction(c.billing_day || 1))
  }
  return total
}

export type BurnAlertClient = { clientId: string; name: string; percent: number; status: ClientBurn['status'] }

// Clients at or over the 75% burn threshold for the dashboard's quiet alert strip - fully quiet
// (returns []) when nobody is over threshold, so a healthy account sees nothing here at all.
function clientsOverBudget(
  billingClients: {
    id: string
    name: string
    retainer_cents: number | null
    retainer_hours: number | null
    billing_mode: string | null
    billing_day: number | null
  }[],
  cycleEntries: { client_id: string | null; duration_seconds: number | null; started_at: string }[],
  targetRateCents: number,
): BurnAlertClient[] {
  return billingClients
    .map((c) => {
      // Each client's own billing cycle, not a shared window - a client billed on the 15th is
      // mid-cycle on the 1st (see computeClientBurn / billingCycleProgress in lib/burn.ts).
      const cycle = billingCycleProgress(c.billing_day || 1)
      const cycleStart = `${cycle.cycleStart}T00:00:00`
      const cycleEnd = `${cycle.cycleEnd}T00:00:00`
      const seconds = cycleEntries
        .filter((e) => e.client_id === c.id && e.started_at >= cycleStart && e.started_at < cycleEnd)
        .reduce((s, e) => s + (e.duration_seconds || 0), 0)
      const burn = computeClientBurn(c, seconds, targetRateCents)
      return burn && burn.percent >= 75 ? { clientId: c.id, name: c.name, percent: burn.percent, status: burn.status } : null
    })
    .filter((b): b is BurnAlertClient => b !== null)
    .sort((a, b) => b.percent - a.percent)
}

export default async function DashboardPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()
  const isAdmin = isAdminRole(role)

  const weekAnchor = getWeekAnchor()
  const today = todayKey()
  const tomorrow = getOffsetDate(1)
  const monthStart = `${today.slice(0, 7)}-01`
  const nextMonthDate = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)
  const monthEnd = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`
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
    { data: weekCompletedTasks },
    { data: billingClients },
    { data: monthEntries },
    { data: cycleEntries },
  ] = await Promise.all([
    // .limit(2000) is a defensive ceiling against pathological growth, not user-facing pagination.
    // The active-tasks query below is intentionally left unbounded - the Today/Overdue/Upcoming
    // bucketing needs the true full active set, and is now covered by idx_tasks_active.
    supabase
      .from('clients')
      .select('id, name, business, platform, stage, status, contract_ends, tone, awaiting_reply, primary_contact_id, last_contacted, cadence_days')
      .eq('org_id', orgId)
      .order('name')
      .limit(2000),
    supabase.from('tasks').select('*').eq('org_id', orgId).eq('archived', false),
    supabase.from('recurring_templates').select('*').eq('org_id', orgId).limit(2000),
    supabase.from('default_task_templates').select('*').eq('org_id', orgId).limit(2000),
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
    // Powers the "This week" completed-tasks count independent of archive status - archiving
    // hides a task from the working list but shouldn't erase it from this week's tally.
    supabase
      .from('tasks')
      .select('assigned_to')
      .eq('org_id', orgId)
      .eq('done', true)
      .gte('completed_at', `${weekAnchor}T00:00:00`)
      .lt('completed_at', `${tomorrow}T00:00:00`),
    // Revenue widget is admin-only (same gate as the Revenue/Reports pages) - skip fetching
    // billing rows entirely for members rather than fetching-then-hiding, since retainer/hourly
    // rate cents must never reach a non-admin session's RSC payload (see stripBillingInfo).
    isAdmin
      ? supabase.from('clients').select('id, name, retainer_cents, retainer_hours, billing_mode, hourly_rate_cents, billing_day, stage, status').eq('org_id', orgId)
      : Promise.resolve({ data: [] }),
    isAdmin
      ? supabase
          .from('time_entries')
          .select('client_id, duration_seconds, billable')
          .eq('org_id', orgId)
          .not('duration_seconds', 'is', null)
          .gte('started_at', `${monthStart}T00:00:00`)
          .lt('started_at', `${monthEnd}T00:00:00`)
      : Promise.resolve({ data: [] }),
    // 62 days covers any billing_day's current cycle in any calendar month - burn tracking is
    // scoped per client's own billing cycle, not this shared calendar-month window (see
    // clientsOverBudget above), so this is deliberately a separate query from monthEntries.
    isAdmin
      ? supabase
          .from('time_entries')
          .select('client_id, duration_seconds, started_at')
          .eq('org_id', orgId)
          .not('duration_seconds', 'is', null)
          .gte('started_at', `${getOffsetDate(-62)}T00:00:00`)
      : Promise.resolve({ data: [] }),
  ])

  const monthRevenueCents = isAdmin ? estimateMonthRevenueCents(billingClients ?? [], monthEntries ?? []) : 0
  const mrrCents = isAdmin ? mrrCentsTotal(billingClients ?? []) : 0
  const targetRateCents = org?.settings?.hourly_cost_cents ?? 0
  const burnAlerts = isAdmin ? clientsOverBudget(billingClients ?? [], cycleEntries ?? [], targetRateCents) : []

  return (
    <DashboardClient
      orgId={orgId}
      userId={user.id}
      isAdmin={isAdmin}
      monthRevenueCents={monthRevenueCents}
      mrrCents={mrrCents}
      burnAlerts={burnAlerts}
      currency={org?.settings?.currency ?? 'usd'}
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
      weekCompletedTasks={weekCompletedTasks ?? []}
    />
  )
}
