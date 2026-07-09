import { NextResponse } from 'next/server'
import { requireAppOwnerApi } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, SEAT_PRICE_ID } from '@/lib/stripe'

// One-time cutover: moves every org with an existing Stripe subscription from the old flat
// $25/seat price onto the new $47 (2 seats incl.)/$17-per-extra-seat tiered price, at whatever
// quantity they already have (floored at 2, since the base price always covers 2 seats now).
// proration_behavior 'none' deliberately avoids surprise mid-cycle charges/credits hitting every
// existing customer at once - normal seat changes going forward still prorate as usual via
// /api/billing/seats. Meant to be run once, manually, right after SEAT_PRICE_ID is pointed at the
// new price - not part of any regular flow.
export async function POST() {
  const gate = await requireAppOwnerApi()
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const stripe = getStripe()

  const { data: orgs } = await admin
    .from('orgs')
    .select('id, seats_purchased, stripe_subscription_id')
    .not('stripe_subscription_id', 'is', null)

  const results: { orgId: string; status: 'migrated' | 'error'; detail?: string }[] = []

  for (const org of orgs || []) {
    try {
      const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id as string)
      const itemId = subscription.items.data[0]?.id
      if (!itemId) {
        results.push({ orgId: org.id, status: 'error', detail: 'no subscription item found' })
        continue
      }
      const quantity = Math.max(org.seats_purchased || 1, 2)
      await stripe.subscriptionItems.update(itemId, { price: SEAT_PRICE_ID, quantity, proration_behavior: 'none' })
      if (quantity !== org.seats_purchased) {
        await admin.from('orgs').update({ seats_purchased: quantity }).eq('id', org.id)
      }
      results.push({ orgId: org.id, status: 'migrated' })
    } catch (err) {
      results.push({ orgId: org.id, status: 'error', detail: (err as Error).message })
    }
  }

  return NextResponse.json({ results })
}
