import { NextResponse } from 'next/server'
import { requireAppOwnerApi } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const gate = await requireAppOwnerApi()
  if ('error' in gate) return gate.error

  const { orgId } = await params
  const { immediate } = await request.json().catch(() => ({ immediate: false }))

  const admin = createAdminClient()
  const { data: org } = await admin.from('orgs').select('stripe_subscription_id').eq('id', orgId).maybeSingle()
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  if (!org.stripe_subscription_id) {
    // Trial-only org, nothing to cancel in Stripe.
    await admin.from('orgs').update({ subscription_status: 'canceled' }).eq('id', orgId)
    return NextResponse.json({ ok: true })
  }

  const stripe = getStripe()
  if (immediate) {
    await stripe.subscriptions.cancel(org.stripe_subscription_id)
    // Optimistic update - the webhook's customer.subscription.deleted will also confirm this.
    await admin.from('orgs').update({ subscription_status: 'canceled' }).eq('id', orgId)
  } else {
    // Leave subscription_status alone - it stays active until the period actually ends,
    // at which point the billing webhook syncs the final canceled state.
    await stripe.subscriptions.update(org.stripe_subscription_id, { cancel_at_period_end: true })
  }

  return NextResponse.json({ ok: true })
}
