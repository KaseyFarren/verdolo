import { NextResponse } from 'next/server'
import { requireAppOwnerApi } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const gate = await requireAppOwnerApi()
  if ('error' in gate) return gate.error

  const { orgId } = await params
  const admin = createAdminClient()

  const { data: members } = await admin.from('org_members').select('user_id').eq('org_id', orgId)
  const userIds = (members ?? []).map((m) => m.user_id)

  // Every org table (org_members, tasks, clients, messages, time_entries, etc.) references
  // orgs.id with on delete cascade, so this one delete clears all of the org's data.
  const { error: orgError } = await admin.from('orgs').delete().eq('id', orgId)
  if (orgError) return NextResponse.json({ error: 'Could not delete org' }, { status: 500 })

  // Single-org-per-user model - every member here belongs to no other org, so it's safe to
  // delete their auth account too (frees their email up for a fresh signup).
  for (const userId of userIds) {
    await admin.auth.admin.deleteUser(userId)
  }

  return NextResponse.json({ ok: true })
}
