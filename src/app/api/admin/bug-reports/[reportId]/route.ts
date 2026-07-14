import { NextResponse } from 'next/server'
import { requireAppOwnerApi } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUSES = ['new', 'acknowledged', 'resolved']

export async function PATCH(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const gate = await requireAppOwnerApi()
  if ('error' in gate) return gate.error

  const { reportId } = await params
  const { status } = await request.json()
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('bug_reports').update({ status }).eq('id', reportId)
  if (error) return NextResponse.json({ error: 'Could not update' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
