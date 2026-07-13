import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { requireOrgOwner, isAuthError } from '@/lib/billing/require-owner'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orgId = searchParams.get('orgId')
  if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

  const auth = await requireOrgOwner(orgId)
  if (isAuthError(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { data: org } = await auth.admin
    .from('orgs')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('id', orgId)
    .single()
  if (!org?.stripe_customer_id) {
    return NextResponse.json({ invoices: [], cancelAtPeriodEnd: false })
  }

  const stripe = getStripe()
  const [invoices, subscription] = await Promise.all([
    stripe.invoices.list({ customer: org.stripe_customer_id, limit: 12 }),
    org.stripe_subscription_id ? stripe.subscriptions.retrieve(org.stripe_subscription_id) : Promise.resolve(null),
  ])

  return NextResponse.json({
    invoices: invoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      created: inv.created,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      status: inv.status,
      hostedInvoiceUrl: inv.hosted_invoice_url,
      invoicePdf: inv.invoice_pdf,
    })),
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
  })
}
