import { NextResponse } from 'next/server'
import { requireAppOwnerApi } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// Deliberately diverges from /api/billing/seats: this is a support "comp seats" action -
// it updates seats_purchased directly and never touches Stripe, since the whole point is
// granting extra capacity without billing the customer more.
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const gate = await requireAppOwnerApi()
  if ('error' in gate) return gate.error

  const { orgId } = await params
  const { seats } = await request.json()
  if (!Number.isInteger(seats) || seats < 1) {
    return NextResponse.json({ error: 'seats must be a positive integer' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { count: activeCount } = await admin
    .from('org_members')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'active')

  if (seats < (activeCount || 0)) {
    return NextResponse.json(
      { error: `This org has ${activeCount} active members - can't set seats below that` },
      { status: 400 }
    )
  }

  const { error } = await admin.from('orgs').update({ seats_purchased: seats }).eq('id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, seats })
}
