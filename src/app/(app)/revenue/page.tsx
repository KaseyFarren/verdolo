import { redirect } from 'next/navigation'
import { requireOrgContext } from '@/lib/org'
import { todayKey } from '@/lib/agency'
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

  const [{ data: clients }, { data: charges }, { data: entries }, { data: members }, { data: tasks }] = await Promise.all([
    supabase.from('clients').select('id, name, retainer_cents, billing_mode, hourly_rate_cents, billing_day, stage, status').eq('org_id', orgId).order('name'),
    supabase
      .from('client_charges')
      .select('*')
      .eq('org_id', orgId)
      .gte('charged_on', rangeStart)
      .lt('charged_on', rangeEnd)
      .order('charged_on', { ascending: false }),
    supabase
      .from('time_entries')
      .select('user_id, client_id, duration_seconds, started_at, billable')
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
  ])

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
      targetRateCents={org?.settings?.hourly_cost_cents ?? 0}
      currency={org?.settings?.currency ?? 'usd'}
    />
  )
}
