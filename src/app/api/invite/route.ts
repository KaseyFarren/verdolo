import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/apiError'

export async function POST(request: Request) {
  const { origin } = new URL(request.url)
  const { email, orgId, role } = await request.json()

  if (!email || !orgId) {
    return NextResponse.json({ error: 'email and orgId are required' }, { status: 400 })
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

  if (membership?.role !== 'admin' && membership?.role !== 'owner') {
    return NextResponse.json({ error: 'Only admins can invite members' }, { status: 403 })
  }

  const invitedRole = role === 'owner' || role === 'admin' ? role : 'member'
  if (invitedRole === 'owner' && membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only an owner can invite another owner' }, { status: 403 })
  }

  const admin = createAdminClient()

  // seat cap only applies once billing is live (active/past_due) - trials (local or Stripe)
  // stay unlimited so a team can fully evaluate the product before paying for seats
  const { data: org } = await admin.from('orgs').select('subscription_status, seats_purchased').eq('id', orgId).single()
  if (org && (org.subscription_status === 'active' || org.subscription_status === 'past_due')) {
    const { count: activeCount } = await admin
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'active')
    if ((activeCount || 0) >= org.seats_purchased) {
      return NextResponse.json(
        { error: `You've used all ${org.seats_purchased} seat(s) on your plan. Add more seats in Billing to invite another teammate.` },
        { status: 403 }
      )
    }
  }

  // /accept-invite (not /auth/callback) is where the invite link lands - see that page for why.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/accept-invite`,
  })

  if (inviteError || !invited.user) {
    return apiError('Could not send the invite', 500, inviteError)
  }

  // Starts 'invited', not 'active' - flips to 'active' (via the accept_own_invite RPC) only once
  // they actually finish setup on /accept-invite, so a pending invite doesn't consume a seat or
  // show up in member pickers until someone is really using it. joined_at is set at that point too.
  const { error: memberError } = await admin.from('org_members').insert({
    org_id: orgId,
    user_id: invited.user.id,
    role: invitedRole,
    status: 'invited',
    invited_email: email,
  })

  if (memberError) {
    return apiError('Could not add the teammate', 500, memberError)
  }

  return NextResponse.json({ ok: true })
}
