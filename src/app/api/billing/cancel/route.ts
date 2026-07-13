import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { requireOrgOwner, isAuthError } from '@/lib/billing/require-owner'

export async function POST(request: Request) {
  const { orgId, cancel } = await request.json()
  if (!orgId || typeof cancel !== 'boolean') {
    return NextResponse.json({ error: 'orgId and cancel are required' }, { status: 400 })
  }

  const auth = await requireOrgOwner(orgId)
  if (isAuthError(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { data: org } = await auth.admin
    .from('orgs')
    .select('stripe_subscription_id, plan_type')
    .eq('id', orgId)
    .single()
  if (org?.plan_type === 'lifetime' || !org?.stripe_subscription_id) {
    return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 })
  }

  const stripe = getStripe()
  const subscription = await stripe.subscriptions.update(org.stripe_subscription_id, {
    cancel_at_period_end: cancel,
  })

  return NextResponse.json({ cancelAtPeriodEnd: subscription.cancel_at_period_end })
}
