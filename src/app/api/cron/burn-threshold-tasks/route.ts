import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthorizedCronRequest } from '@/lib/cronAuth'
import { getStage, getOffsetDate, todayKey } from '@/lib/agency'
import { billingCycleProgress } from '@/lib/period'
import { computeClientBurn, burnDrivers, BURN_THRESHOLDS } from '@/lib/burn'

// Runs daily (see vercel.json), one hour after contract-expiry-tasks. Mirrors that route exactly:
// a silent is_auto task per client per threshold crossed, assigned to the client's point of
// contact. due_date = the current billing cycle's start date, so the unique constraint shared
// with contract-expiry (org_id, client_id, due_date, auto_type - see migration 0068) dedupes
// against the cycle itself - re-running daily creates nothing new, and the next cycle's new
// cycleStart naturally produces a fresh task if the client crosses the threshold again.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const today = todayKey()

  const { data: clients } = await admin
    .from('clients')
    .select('id, org_id, name, retainer_cents, retainer_hours, billing_mode, billing_day, primary_contact_id, stage, status')
    .eq('billing_mode', 'retainer')
    .gt('retainer_cents', 0)
    .not('primary_contact_id', 'is', null)

  const activeClients = (clients || []).filter((c) => getStage(c) !== 'Churned')
  if (!activeClients.length) return NextResponse.json({ created: 0 })

  const orgIds = [...new Set(activeClients.map((c) => c.org_id))]
  const clientIds = activeClients.map((c) => c.id)

  const [{ data: orgs }, { data: entries }] = await Promise.all([
    admin.from('orgs').select('id, settings').in('id', orgIds),
    // 62 days covers any billing_day's current cycle in any calendar month.
    admin
      .from('time_entries')
      .select('client_id, task_id, duration_seconds, started_at')
      .in('client_id', clientIds)
      .not('duration_seconds', 'is', null)
      .gte('started_at', `${getOffsetDate(-62)}T00:00:00`),
  ])

  const targetRateByOrg = new Map<string, number>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (orgs || []).map((o) => [o.id, ((o.settings as any)?.hourly_cost_cents as number | undefined) || 0])
  )

  const entriesByClient = new Map<string, { client_id: string; task_id: string | null; duration_seconds: number | null; started_at: string }[]>()
  for (const e of entries || []) {
    if (!e.client_id) continue
    const list = entriesByClient.get(e.client_id) || []
    list.push(e)
    entriesByClient.set(e.client_id, list)
  }

  const taskIds = [...new Set((entries || []).map((e) => e.task_id).filter((id): id is string => !!id))]
  const { data: tasksData } = taskIds.length ? await admin.from('tasks').select('id, title').in('id', taskIds) : { data: [] }
  const taskTitles = new Map((tasksData || []).map((t) => [t.id, t.title]))

  const rows: Record<string, unknown>[] = []

  for (const client of activeClients) {
    const targetRateCents = targetRateByOrg.get(client.org_id) || 0
    const allEntries = entriesByClient.get(client.id) || []
    const cycle = billingCycleProgress(client.billing_day || 1, today)
    const cycleStart = `${cycle.cycleStart}T00:00:00`
    const cycleEnd = `${cycle.cycleEnd}T00:00:00`
    const cycleEntries = allEntries.filter((e) => e.started_at >= cycleStart && e.started_at < cycleEnd)
    const secondsThisCycle = cycleEntries.reduce((s, e) => s + (e.duration_seconds || 0), 0)

    const burn = computeClientBurn(client, secondsThisCycle, targetRateCents, today)
    if (!burn) continue

    const drivers = burnDrivers(cycleEntries, taskTitles)
    const driversLine = drivers.length
      ? `Top drivers: ${drivers.map((d) => `${d.title} ${d.hours.toFixed(1)}h`).join(', ')}.`
      : 'No time entries recorded yet this cycle.'

    for (const threshold of BURN_THRESHOLDS) {
      if (burn.percent < threshold) continue
      rows.push({
        org_id: client.org_id,
        client_id: client.id,
        title: `${client.name} at ${threshold}% of retainer hours`,
        due_date: burn.cycle.cycleStart,
        priority: threshold >= 100 ? 'High' : 'Medium',
        notes: `${burn.hoursLogged.toFixed(1)}h logged of ~${burn.hoursBudget.toFixed(1)}h supported by the retainer, day ${burn.cycle.elapsedDays} of ${burn.cycle.cycleLengthDays} in this cycle.\n${driversLine}`,
        assignee_ids: [client.primary_contact_id],
        assigned_to: client.primary_contact_id,
        done: false,
        is_auto: true,
        auto_type: `burn_${threshold}`,
      })
    }
  }

  if (!rows.length) return NextResponse.json({ created: 0 })

  const { data, error } = await admin
    .from('tasks')
    .upsert(rows, { onConflict: 'org_id,client_id,due_date,auto_type', ignoreDuplicates: true })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ created: data?.length || 0 })
}
