import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import type Stripe from 'stripe'

function mapStatus(stripeStatus: Stripe.Subscription.Status): 'trialing' | 'active' | 'past_due' | 'canceled' {
  if (stripeStatus === 'trialing') return 'trialing'
  if (stripeStatus === 'active') return 'active'
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid' || stripeStatus === 'incomplete') return 'past_due'
  return 'canceled'
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const admin = createAdminClient()
  const orgId = subscription.metadata?.org_id
  // current_period_end moved to the subscription item in recent Stripe API versions -
  // it no longer exists on the top-level Subscription object.
  const item = subscription.items.data[0]
  const seats = item?.quantity ?? 1
  const currentPeriodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null

  const query = admin
    .from('orgs')
    .update({
      stripe_subscription_id: subscription.id,
      subscription_status: mapStatus(subscription.status),
      seats_purchased: seats,
      current_period_end: currentPeriodEnd,
    })

  if (orgId) {
    await query.eq('id', orgId)
  } else {
    await query.eq('stripe_customer_id', subscription.customer as string)
  }
}

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const stripe = getStripe()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('[api] Stripe webhook signature verification failed:', (err as Error).message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session

      // No org_id metadata means this didn't come from the authenticated in-app upgrade flow
      // (src/app/api/billing/checkout/route.ts always sets it) - it's a pre-account Payment Link
      // purchase instead. Record it in purchase_tokens; /create-account is what turns it into an
      // org, once the buyer picks a password and agency name.
      if (!session.metadata?.org_id) {
        const admin = createAdminClient()
        const isLifetime = session.mode === 'payment'
        const subscriptionId = session.mode === 'subscription' && session.subscription
          ? ((await getStripe().subscriptions.retrieve(session.subscription as string)).id)
          : null

        await admin.from('purchase_tokens').upsert(
          {
            stripe_checkout_session_id: session.id,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: subscriptionId,
            plan_type: isLifetime ? 'lifetime' : 'subscription',
            email: session.customer_details?.email ?? '',
            seats_purchased: 2,
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          },
          { onConflict: 'stripe_checkout_session_id', ignoreDuplicates: true }
        )
        break
      }

      if (session.subscription) {
        const stripeInstance = getStripe()
        const subscription = await stripeInstance.subscriptions.retrieve(session.subscription as string)
        await syncSubscription(subscription)
      }
      break
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      await syncSubscription(event.data.object as Stripe.Subscription)
      break
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const admin = createAdminClient()
      const orgId = subscription.metadata?.org_id
      const query = admin.from('orgs').update({ subscription_status: 'canceled' })
      if (orgId) await query.eq('id', orgId)
      else await query.eq('stripe_customer_id', subscription.customer as string)
      break
    }
    default:
      break
  }

  return NextResponse.json({ received: true })
}
