import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'

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
  const { data: org } = await admin.from('orgs').select('stripe_customer_id').eq('id', orgId).single()
  if (!org?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account yet - subscribe first' }, { status: 400 })
  }

  const stripe = getStripe()
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${origin}/settings?view=billing`,
  })

  return NextResponse.json({ url: session.url })
}
