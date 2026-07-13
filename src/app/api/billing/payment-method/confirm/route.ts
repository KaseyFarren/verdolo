import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { requireOrgOwner, isAuthError } from '@/lib/billing/require-owner'

export async function POST(request: Request) {
  const { orgId, setupIntentId } = await request.json()
  if (!orgId || !setupIntentId) {
    return NextResponse.json({ error: 'orgId and setupIntentId are required' }, { status: 400 })
  }

  const auth = await requireOrgOwner(orgId)
  if (isAuthError(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { data: org } = await auth.admin
    .from('orgs')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('id', orgId)
    .single()
  if (!org?.stripe_customer_id) return NextResponse.json({ error: 'No billing account found' }, { status: 400 })

  const stripe = getStripe()
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
  // The setup intent's customer must match this org's Stripe customer - otherwise an owner could
  // pass a setupIntentId from an unrelated session and attach someone else's payment method here.
  if (
    setupIntent.customer !== org.stripe_customer_id ||
    setupIntent.status !== 'succeeded' ||
    !setupIntent.payment_method
  ) {
    return NextResponse.json({ error: 'Payment method setup did not complete' }, { status: 400 })
  }
  const paymentMethodId = setupIntent.payment_method as string

  await stripe.customers.update(org.stripe_customer_id, {
    invoice_settings: { default_payment_method: paymentMethodId },
  })
  if (org.stripe_subscription_id) {
    await stripe.subscriptions.update(org.stripe_subscription_id, { default_payment_method: paymentMethodId })
  }

  return NextResponse.json({ success: true })
}
