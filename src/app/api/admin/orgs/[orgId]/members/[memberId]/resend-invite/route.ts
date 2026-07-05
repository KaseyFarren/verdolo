import { NextResponse } from 'next/server'
import { requireAppOwnerApi } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string; memberId: string }> }) {
  const gate = await requireAppOwnerApi()
  if ('error' in gate) return gate.error

  const { origin } = new URL(request.url)
  const { orgId, memberId } = await params

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('org_members')
    .select('org_id, invited_email')
    .eq('id', memberId)
    .maybeSingle()

  if (!member || member.org_id !== orgId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  if (!member.invited_email) {
    return NextResponse.json({ error: 'This member has no invite email on file' }, { status: 400 })
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(member.invited_email, {
    redirectTo: `${origin}/auth/callback?next=/dashboard`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
