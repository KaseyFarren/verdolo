import { isAdminRole, requireOrgContext } from '@/lib/org'
import { getOffsetDate, stripBillingInfo } from '@/lib/agency'
import { billingCycleProgress } from '@/lib/period'
import { computeClientBurn, type ClientBurn } from '@/lib/burn'
import ClientsClient from './ClientsClient'

export default async function ClientsPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()
  const canEdit = isAdminRole(role)

  const [
    { data: clients },
    { data: notes },
    { data: tasks },
    { data: aiMessages },
    { data: timeEntries },
    { data: archivedTimeTotals },
    { data: members },
    { data: healthSnapshots },
    { data: cycleEntries },
  ] = await Promise.all([
    // .limit(2000) below is a defensive ceiling against pathological growth (e.g. a runaway
    // automation bug), not user-facing pagination - see supabase/migrations plan notes. Realistic
    // per-org volume (clients, notes) for this product stays well under that.
    supabase.from('clients').select('*').eq('org_id', orgId).order('name').limit(2000),
    supabase.from('client_notes').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(2000),
    supabase.from('tasks').select('*').eq('org_id', orgId).eq('done', true).not('completed_at', 'is', null).limit(2000),
    supabase.from('ai_message_log').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    supabase.from('time_entries').select('client_id, duration_seconds').eq('org_id', orgId).not('duration_seconds', 'is', null).limit(2000),
    supabase.from('time_archived_totals').select('client_id, seconds').eq('org_id', orgId),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url').eq('org_id', orgId).eq('status', 'active'),
    supabase
      .from('client_health_snapshots')
      .select('client_id, snapshot_date, health')
      .eq('org_id', orgId)
      .gte('snapshot_date', new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10))
      .order('snapshot_date', { ascending: true }),
    // Deliberately a separate query from the unbounded lifetime `timeEntries` above - burn is
    // scoped to each client's own billing cycle (up to 62 days back), not all-time totals.
    // Admin-gated below, same reasoning as stripBillingInfo: never fetch billing-adjacent rows
    // for a session that can't see them.
    canEdit
      ? supabase
          .from('time_entries')
          .select('client_id, duration_seconds, started_at')
          .eq('org_id', orgId)
          .not('duration_seconds', 'is', null)
          .gte('started_at', `${getOffsetDate(-62)}T00:00:00`)
      : Promise.resolve({ data: [] }),
  ])

  // billing amounts are revenue - members (view-only on clients) don't get them, admins/owners do
  const visibleClients = canEdit ? clients ?? [] : stripBillingInfo(clients ?? [])

  const clientBurn: Record<string, ClientBurn> = {}
  if (canEdit) {
    const targetRateCents = org?.settings?.hourly_cost_cents ?? 0
    for (const c of visibleClients) {
      // Each client's own billing cycle, not the shared 62-day fetch window - a client billed
      // on the 15th is mid-cycle on the 1st (see computeClientBurn in lib/burn.ts).
      const cycle = billingCycleProgress(c.billing_day || 1)
      const cycleStart = `${cycle.cycleStart}T00:00:00`
      const cycleEnd = `${cycle.cycleEnd}T00:00:00`
      const seconds = (cycleEntries ?? [])
        .filter((e) => e.client_id === c.id && e.started_at >= cycleStart && e.started_at < cycleEnd)
        .reduce((s, e) => s + (e.duration_seconds || 0), 0)
      const burn = computeClientBurn(c, seconds, targetRateCents)
      if (burn) clientBurn[c.id] = burn
    }
  }

  return (
    <ClientsClient
      orgId={orgId}
      userId={user.id}
      canEdit={canEdit}
      initialClients={visibleClients}
      initialNotes={notes ?? []}
      completedTasks={tasks ?? []}
      aiMessages={aiMessages ?? []}
      timeEntries={timeEntries ?? []}
      archivedTimeTotals={archivedTimeTotals ?? []}
      members={members ?? []}
      healthSnapshots={healthSnapshots ?? []}
      clientBurn={clientBurn}
      currency={org?.settings?.currency ?? 'usd'}
    />
  )
}
