import { NextResponse } from 'next/server'
import { requireAppOwnerApi } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const gate = await requireAppOwnerApi()
  if ('error' in gate) return gate.error

  const { orgId } = await params
  const { days } = await request.json()
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return NextResponse.json({ error: 'days must be an integer between 1 and 365' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: org } = await admin
    .from('orgs')
    .select('trial_ends_at, stripe_subscription_id, subscription_status')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  const base = org.trial_ends_at && new Date(org.trial_ends_at) > new Date() ? new Date(org.trial_ends_at) : new Date()
  const newTrialEndsAt = new Date(base.getTime() + days * 86400000).toISOString()

  const update: Record<string, unknown> = { trial_ends_at: newTrialEndsAt }
  // Only flip status to trialing for orgs with no real Stripe subscription - an org
  // that's actually subscribed keeps whatever status the billing webhook says.
  if (!org.stripe_subscription_id) update.subscription_status = 'trialing'

  await admin.from('orgs').update(update).eq('id', orgId)

  return NextResponse.json({ ok: true, trialEndsAt: newTrialEndsAt })
}
