import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { requireOrgContext } from '@/lib/org'
import { todayKey } from '@/lib/agency'
import RevenueClient from './RevenueClient'

export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  // revenue is owner-only — redirect server-side before any revenue data is fetched, rather
  // than relying on a client-side check (Server Component props still serialize to the client
  // regardless of what's rendered, same reasoning as stripRetainer() in lib/agency.ts)
  if (role !== 'owner') redirect('/dashboard')

  const { month: monthParam } = await searchParams
  const now = new Date()
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [y, m] = month.split('-').map(Number)
  const monthStart = `${month}-01`
  const nextMonthDate = new Date(y, m, 1)
  const monthEnd = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`

  const [{ data: clients }, { data: charges }, { data: entries }, { data: members }, { data: tasks }] = await Promise.all([
    supabase.from('clients').select('id, name, retainer_cents, stage, status').eq('org_id', orgId).order('name'),
    supabase
      .from('client_charges')
      .select('*')
      .eq('org_id', orgId)
      .gte('charged_on', monthStart)
      .lt('charged_on', monthEnd)
      .order('charged_on', { ascending: false }),
    supabase
      .from('time_entries')
      .select('user_id, client_id, duration_seconds, started_at')
      .eq('org_id', orgId)
      .gte('started_at', monthStart)
      .lt('started_at', monthEnd),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url, role').eq('org_id', orgId).eq('status', 'active'),
    // original_due_date is frozen at creation (see migration 0020) so this can't be gamed by
    // pushing due_date forward — completed/overdue/late counters always reflect the original commitment
    supabase
      .from('tasks')
      .select('assigned_to, done, completed_at, original_due_date')
      .eq('org_id', orgId)
      .not('assigned_to', 'is', null)
      .gte('original_due_date', monthStart)
      .lt('original_due_date', monthEnd),
  ])

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <RevenueClient
        orgId={orgId}
        month={month}
        today={todayKey()}
        clients={clients ?? []}
        initialCharges={charges ?? []}
        entries={entries ?? []}
        members={members ?? []}
        tasks={tasks ?? []}
      />
    </AppShell>
  )
}
