import { NextResponse } from 'next/server'
import { requireAppOwnerApi } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// Comps a lifetime license (or reverts one) with no Stripe purchase involved - for partners,
// beta users, or manual sales. Mirrors the existing seats/route.ts "comp, don't touch Stripe"
// pattern. Reverting to 'subscription' does not itself create a Stripe subscription - the org
// would go through /api/billing/checkout normally afterward if it needs to actually be billed.
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const gate = await requireAppOwnerApi()
  if ('error' in gate) return gate.error

  const { orgId } = await params
  const { planType } = await request.json()
  if (planType !== 'subscription' && planType !== 'lifetime') {
    return NextResponse.json({ error: "planType must be 'subscription' or 'lifetime'" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: org } = await admin.from('orgs').select('seats_purchased').eq('id', orgId).maybeSingle()
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  const update: Record<string, unknown> = { plan_type: planType }
  if (planType === 'lifetime') {
    update.subscription_status = 'active'
    update.seats_purchased = Math.max(org.seats_purchased || 1, 4)
  }

  await admin.from('orgs').update(update).eq('id', orgId)

  return NextResponse.json({ ok: true, planType })
}
