import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripe, connectAccount } from '@/lib/stripe'

export type LineItem = { description: string; amount_cents: number; quantity: number; chargeId?: string }

/** Shared by the manual "Create Invoice" route and the recurring-retainer cron —
 * creates the Stripe customer/invoice on the agency's connected account, sends it,
 * and records the result in `invoices`. Callers own auth/permission checks. */
export async function createAndSendInvoice({
  admin,
  orgId,
  clientId,
  accountId,
  lineItems,
  source = 'manual',
}: {
  admin: SupabaseClient
  orgId: string
  clientId: string
  accountId: string
  lineItems: LineItem[]
  source?: 'manual' | 'recurring'
}) {
  const { data: client } = await admin.from('clients').select('id, name, contact_email, stripe_customer_id').eq('id', clientId).eq('org_id', orgId).single()
  if (!client) throw new Error('Client not found')

  const stripe = getStripe()

  let stripeCustomerId = client.stripe_customer_id as string | null
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({ name: client.name, email: client.contact_email || undefined }, connectAccount(accountId))
    stripeCustomerId = customer.id
    await admin.from('clients').update({ stripe_customer_id: stripeCustomerId }).eq('id', clientId)
  }

  for (const item of lineItems) {
    await stripe.invoiceItems.create(
      { customer: stripeCustomerId, currency: 'gbp', amount: item.amount_cents * (item.quantity || 1), description: item.description },
      connectAccount(accountId)
    )
  }

  const draftInvoice = await stripe.invoices.create(
    { customer: stripeCustomerId, collection_method: 'send_invoice', days_until_due: 14, auto_advance: true },
    connectAccount(accountId)
  )
  await stripe.invoices.finalizeInvoice(draftInvoice.id!, {}, connectAccount(accountId))
  const sentInvoice = await stripe.invoices.sendInvoice(draftInvoice.id!, {}, connectAccount(accountId))

  const totalCents = lineItems.reduce((sum, item) => sum + item.amount_cents * (item.quantity || 1), 0)
  const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)

  const { data: invoiceRow } = await admin
    .from('invoices')
    .insert({
      org_id: orgId,
      client_id: clientId,
      stripe_invoice_id: sentInvoice.id,
      amount_cents: totalCents,
      status: 'open',
      due_date: dueDate,
      line_items: lineItems,
      stripe_hosted_invoice_url: sentInvoice.hosted_invoice_url,
      stripe_pdf_url: sentInvoice.invoice_pdf,
      sent_at: new Date().toISOString(),
      source,
    })
    .select()
    .single()

  const chargeIds = lineItems.map((item) => item.chargeId).filter((id): id is string => !!id)
  if (chargeIds.length) {
    await admin.from('client_charges').update({ invoice_id: invoiceRow?.id }).in('id', chargeIds)
  }

  return invoiceRow
}
