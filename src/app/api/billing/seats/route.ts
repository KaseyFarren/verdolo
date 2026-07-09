import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, LIFETIME_EXTRA_SEAT_PRICE_ID } from '@/lib/stripe'

export async function POST(request: Request) {
  const { orgId, seats } = await request.json()
  if (!orgId || !Number.isInteger(seats) || seats < 1) {
    return NextResponse.json({ error: 'orgId and a positive integer seats count are required' }, { status: 400 })
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
  if (membership?.role !== 'owner') {
    return NextResponse.json({ error: 'Only the org owner can manage seats' }, { status: 403 })
  }

  const admin = createAdminClient()
  const [{ data: org }, { count: activeCount }] = await Promise.all([
    admin.from('orgs').select('stripe_subscription_id, stripe_customer_id, plan_type').eq('id', orgId).single(),
    admin.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'active'),
  ])
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })
  if (seats < (activeCount || 0)) {
    return NextResponse.json({ error: `You have ${activeCount} active members - remove someone before lowering seats below that` }, { status: 400 })
  }
  if (org.plan_type === 'lifetime' && seats < 2) {
    return NextResponse.json({ error: 'A lifetime license always includes 2 seats' }, { status: 400 })
  }

  const stripe = getStripe()

  if (org.plan_type === 'lifetime') {
    // The lifetime one-time payment already covers the first 2 seats - only seats beyond that
    // are ever billed, on a separate flat (non-tiered) subscription created on demand.
    const extraSeats = Math.max(seats - 2, 0)
    if (org.stripe_subscription_id) {
      const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
      const itemId = subscription.items.data[0]?.id
      if (extraSeats === 0) {
        await stripe.subscriptions.cancel(org.stripe_subscription_id)
        await admin.from('orgs').update({ stripe_subscription_id: null }).eq('id', orgId)
      } else if (itemId) {
        await stripe.subscriptionItems.update(itemId, { quantity: extraSeats, proration_behavior: 'create_prorations' })
      }
    } else if (extraSeats > 0) {
      const subscription = await stripe.subscriptions.create({
        customer: org.stripe_customer_id as string,
        items: [{ price: LIFETIME_EXTRA_SEAT_PRICE_ID, quantity: extraSeats }],
        metadata: { org_id: orgId },
      })
      await admin.from('orgs').update({ stripe_subscription_id: subscription.id }).eq('id', orgId)
    }
  } else if (org.stripe_subscription_id) {
    const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
    const itemId = subscription.items.data[0]?.id
    if (itemId) {
      await stripe.subscriptionItems.update(itemId, { quantity: seats, proration_behavior: 'create_prorations' })
    }
  }

  await admin.from('orgs').update({ seats_purchased: seats }).eq('id', orgId)

  return NextResponse.json({ ok: true, seats })
}
