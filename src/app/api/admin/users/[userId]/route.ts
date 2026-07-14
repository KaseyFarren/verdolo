import { NextResponse } from 'next/server'
import { requireAppOwnerApi } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await requireAppOwnerApi()
  if ('error' in gate) return gate.error

  const { userId } = await params
  const admin = createAdminClient()

  // Only ever delete accounts with no org membership - this endpoint is for cleaning up
  // abandoned signups, not a general-purpose user deletion tool. A member's account is deleted
  // (along with everything else) via the org delete route instead.
  const { count } = await admin.from('org_members').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'This account belongs to an org - delete the org instead' }, { status: 400 })
  }

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return NextResponse.json({ error: 'Could not delete account' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
