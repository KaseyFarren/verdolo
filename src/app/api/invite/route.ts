import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/dashboard`,
  })

  if (inviteError || !invited.user) {
    return NextResponse.json({ error: inviteError?.message ?? 'Invite failed' }, { status: 500 })
  }

  const { error: memberError } = await admin.from('org_members').insert({
    org_id: orgId,
    user_id: invited.user.id,
    role: invitedRole,
    status: 'active',
    invited_email: email,
    joined_at: new Date().toISOString(),
  })

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
