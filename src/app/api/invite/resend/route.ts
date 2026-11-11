import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/apiError'
import { inviterDetails, issueSetupLink, sendTeamInviteEmail } from '@/lib/invites'

export async function POST(request: Request) {
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

  // inviteUserByEmail can't re-invite an email that already has an auth user (which every
  // pending invite does), so this used to fail - issueSetupLink falls back to a magic link.
  const link = await issueSetupLink(admin, target.invited_email)
  if ('error' in link) {
    return apiError('Could not resend the invite', 500, link.error)
  }
  const { data: orgRow } = await admin.from('orgs').select('name').eq('id', orgId).single()
  const inviter = await inviterDetails(admin, orgId, user.id, user.email)
  const sent = await sendTeamInviteEmail({ to: target.invited_email, url: link.url, orgName: orgRow?.name ?? 'your team', inviterName: inviter.name, inviterEmail: inviter.email })
  if (!sent) return NextResponse.json({ error: 'Could not send the email' }, { status: 502 })

  return NextResponse.json({ ok: true })
}
