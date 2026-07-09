import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAndSendInvoice, type LineItem } from '@/lib/invoicing'
import { isAuthorizedCronRequest } from '@/lib/cronAuth'
import { getStage, centsToDollars, currencySymbol } from '@/lib/agency'

// Runs on the 1st of the month (see vercel.json). For every org with Stripe Connect active,
// invoices every non-churned client with a non-zero retainer, or on billing_mode 'hourly' -
// the same line-item shape (retainer or hours-worked + any unbilled client_charges) as the
// manual "Create Invoice" flow in ClientsClient.tsx, just headless. Skips a client if it's
// already been invoiced this month (source = 'recurring'), so a re-run or a slow cron doesn't
// double-bill.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const { data: orgs } = await admin.from('orgs').select('id, stripe_connect_account_id, settings').eq('stripe_connect_status', 'active')

  const results: { clientId: string; status: 'invoiced' | 'skipped' | 'error'; detail?: string }[] = []

  for (const org of orgs || []) {
    const accountId = org.stripe_connect_account_id as string | null
    if (!accountId) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currencySign = currencySymbol((org.settings as any)?.currency)

    const [{ data: clients }, { data: alreadyBilled }, { data: unbilledCharges }, { data: unbilledTimeEntries }] = await Promise.all([
      admin
        .from('clients')
        .select('id, stage, status, billing_mode, retainer_cents, hourly_rate_cents')
        .eq('org_id', org.id)
        .or('retainer_cents.gt.0,billing_mode.eq.hourly'),
      admin.from('invoices').select('client_id').eq('org_id', org.id).eq('source', 'recurring').gte('sent_at', monthStart.toISOString()),
      admin.from('client_charges').select('*').eq('org_id', org.id).is('invoice_id', null),
      // Unbilled billable hours, excluding the still-in-progress current month - no lower date
      // bound, same "unbilled = invoice_id is null" semantics as client_charges above, so a
      // missed/errored cron run rolls its stranded hours into the next invoice instead of
      // losing them.
      admin
        .from('time_entries')
        .select('id, client_id, duration_seconds')
        .eq('org_id', org.id)
        .eq('billable', true)
        .is('invoice_id', null)
        .lt('started_at', monthStart.toISOString()),
    ])

    const alreadyBilledIds = new Set((alreadyBilled || []).map((r) => r.client_id))

    for (const client of clients || []) {
      if (getStage(client) === 'Churned') continue
      if (alreadyBilledIds.has(client.id)) {
        results.push({ clientId: client.id, status: 'skipped', detail: 'already invoiced this month' })
        continue
      }

      const lineItems: LineItem[] = []
      if (client.billing_mode === 'hourly') {
        const entries = (unbilledTimeEntries || []).filter((e) => e.client_id === client.id)
        const hours = entries.reduce((s, e) => s + (e.duration_seconds || 0), 0) / 3600
        if (hours > 0) {
          lineItems.push({
            description: `Hourly work (${hours.toFixed(1)}h @ ${currencySign}${centsToDollars(client.hourly_rate_cents || 0)}/hr)`,
            amount_cents: Math.round(hours * (client.hourly_rate_cents || 0)),
            quantity: 1,
            timeEntryIds: entries.map((e) => e.id),
          })
        }
      } else if (client.retainer_cents) {
        lineItems.push({ description: 'Monthly retainer', amount_cents: client.retainer_cents, quantity: 1 })
      }
      for (const charge of (unbilledCharges || []).filter((c) => c.client_id === client.id)) {
        lineItems.push({ description: charge.description, amount_cents: charge.amount_cents, quantity: 1, chargeId: charge.id })
      }

      // Only reachable for hourly clients (retainer clients always have >=1 line item since the
      // query above guarantees retainer_cents > 0) - an hourly client can legitimately have
      // nothing to bill this month.
      if (!lineItems.length) {
        results.push({ clientId: client.id, status: 'skipped', detail: 'nothing to bill' })
        continue
      }

      try {
        await createAndSendInvoice({ admin, orgId: org.id, clientId: client.id, accountId, lineItems, source: 'recurring' })
        results.push({ clientId: client.id, status: 'invoiced' })
      } catch (err) {
        results.push({ clientId: client.id, status: 'error', detail: (err as Error).message })
      }
    }
  }

  return NextResponse.json({ results })
}
