import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, SEAT_PRICE_ID } from '@/lib/stripe'

export async function POST(request: Request) {
  const { origin } = new URL(request.url)
  const { orgId } = await request.json()
  if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

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
    return NextResponse.json({ error: 'Only the org owner can manage billing' }, { status: 403 })
  }

  const admin = createAdminClient()
  const [{ data: org }, { count: seatCount }] = await Promise.all([
    admin.from('orgs').select('*').eq('id', orgId).single(),
    admin.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'active'),
  ])
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  const stripe = getStripe()
  let customerId = org.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { org_id: orgId } })
    customerId = customer.id
    await admin.from('orgs').update({ stripe_customer_id: customerId }).eq('id', orgId)
  }

  const trialEndsAt = org.trial_ends_at ? new Date(org.trial_ends_at) : null
  const trialDaysRemaining = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000)) : 0

  const session = await stripe.checkout.sessions.create({
    ui_mode: 'embedded_page',
    mode: 'subscription',
    customer: customerId,
    line_items: [
      {
        price: SEAT_PRICE_ID,
        quantity: Math.max(seatCount || 1, 1),
        adjustable_quantity: { enabled: true, minimum: Math.max(seatCount || 1, 1), maximum: 50 },
      },
    ],
    subscription_data: trialDaysRemaining > 0 ? { trial_period_days: trialDaysRemaining, metadata: { org_id: orgId } } : { metadata: { org_id: orgId } },
    return_url: `${origin}/settings?view=billing&checkout=success`,
    metadata: { org_id: orgId },
  })

  return NextResponse.json({ clientSecret: session.client_secret })
}
