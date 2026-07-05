import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, connectAccount } from '@/lib/stripe'

type LineItem = { description: string; amount_cents: number; quantity: number; chargeId?: string }

export async function POST(request: Request) {
  const { orgId, clientId, lineItems } = (await request.json()) as {
    orgId: string
    clientId: string
    lineItems: LineItem[]
  }
  if (!orgId || !clientId || !lineItems?.length) {
    return NextResponse.json({ error: 'orgId, clientId, and at least one line item are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (membership?.role !== 'owner' && membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins and owners can send invoices' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: org } = await admin
    .from('orgs')
    .select('stripe_connect_account_id, stripe_connect_status')
    .eq('id', orgId)
    .single()
  if (!org?.stripe_connect_account_id || org.stripe_connect_status !== 'active') {
    return NextResponse.json({ error: 'Connect client billing to Stripe first (Settings → Integrations)' }, { status: 400 })
  }
  const accountId = org.stripe_connect_account_id as string

  const { data: client } = await admin
    .from('clients')
    .select('id, name, contact_email, stripe_customer_id')
    .eq('id', clientId)
    .eq('org_id', orgId)
    .single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const stripe = getStripe()

  try {
    let stripeCustomerId = client.stripe_customer_id as string | null
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        { name: client.name, email: client.contact_email || undefined },
        connectAccount(accountId)
      )
      stripeCustomerId = customer.id
      await admin.from('clients').update({ stripe_customer_id: stripeCustomerId }).eq('id', clientId)
    }

    for (const item of lineItems) {
      await stripe.invoiceItems.create(
        {
          customer: stripeCustomerId,
          currency: 'gbp',
          amount: item.amount_cents * (item.quantity || 1),
          description: item.description,
        },
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
      })
      .select()
      .single()

    const chargeIds = lineItems.map((item) => item.chargeId).filter((id): id is string => !!id)
    if (chargeIds.length) {
      await admin.from('client_charges').update({ invoice_id: invoiceRow?.id }).in('id', chargeIds)
    }

    return NextResponse.json({ invoice: invoiceRow })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
