import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { requireOrgOwner, isAuthError } from '@/lib/billing/require-owner'

export async function POST(request: Request) {
  const { orgId } = await request.json()
  if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

  const auth = await requireOrgOwner(orgId)
  if (isAuthError(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { data: org } = await auth.admin.from('orgs').select('stripe_customer_id').eq('id', orgId).single()
  if (!org?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account yet - subscribe first' }, { status: 400 })
  }

  const stripe = getStripe()
  const setupIntent = await stripe.setupIntents.create({
    customer: org.stripe_customer_id,
    payment_method_types: ['card'],
    usage: 'off_session',
  })

  return NextResponse.json({ clientSecret: setupIntent.client_secret })
}
