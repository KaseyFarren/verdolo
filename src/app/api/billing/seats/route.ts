import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'

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
    admin.from('orgs').select('stripe_subscription_id').eq('id', orgId).single(),
    admin.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'active'),
  ])
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })
  if (seats < (activeCount || 0)) {
    return NextResponse.json({ error: `You have ${activeCount} active members - remove someone before lowering seats below that` }, { status: 400 })
  }

  if (org.stripe_subscription_id) {
    const stripe = getStripe()
    const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
    const itemId = subscription.items.data[0]?.id
    if (itemId) {
      await stripe.subscriptionItems.update(itemId, { quantity: seats, proration_behavior: 'create_prorations' })
    }
  }

  await admin.from('orgs').update({ seats_purchased: seats }).eq('id', orgId)

  return NextResponse.json({ ok: true, seats })
}
