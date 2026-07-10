import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { origin } = new URL(request.url)
  const { orgId, memberId } = await request.json()

  if (!orgId || !memberId) {
    return NextResponse.json({ error: 'orgId and memberId are required' }, { status: 400 })
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
    return NextResponse.json({ error: 'Only admins can resend invites' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: target } = await admin.from('org_members').select('org_id, status, invited_email').eq('id', memberId).maybeSingle()

  if (!target || target.org_id !== orgId || target.status !== 'invited' || !target.invited_email) {
    return NextResponse.json({ error: 'Invite not found or already accepted' }, { status: 400 })
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(target.invited_email, {
    redirectTo: `${origin}/accept-invite`,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
