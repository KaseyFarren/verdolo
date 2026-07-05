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
    return NextResponse.json({ error: 'Only the org owner can connect client billing' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: org } = await admin.from('orgs').select('stripe_connect_account_id').eq('id', orgId).single()
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  const stripe = getStripe()
  let accountId = org.stripe_connect_account_id as string | null

  try {
    if (!accountId) {
      const account = await stripe.accounts.create({ type: 'standard', email: user.email })
      accountId = account.id
      await admin
        .from('orgs')
        .update({ stripe_connect_account_id: accountId, stripe_connect_status: 'pending' })
        .eq('id', orgId)
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/settings?view=integrations`,
      return_url: `${origin}/settings?view=integrations&connect=return`,
      type: 'account_onboarding',
    })

    return NextResponse.json({ url: accountLink.url })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
