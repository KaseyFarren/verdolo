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
  const seats = subscription.items.data[0]?.quantity ?? 1

  const query = admin
    .from('orgs')
    .update({
      stripe_subscription_id: subscription.id,
      subscription_status: mapStatus(subscription.status),
      seats_purchased: seats,
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
    return NextResponse.json({ error: `Invalid signature: ${(err as Error).message}` }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
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
