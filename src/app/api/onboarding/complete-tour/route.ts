import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Called on both "finish" and "skip" - skipping still counts as having seen the tour, same as
// finishing it, so it never re-triggers on the next page load.
export async function POST(request: Request) {
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
    return NextResponse.json({ error: 'Only the org owner completes the tour' }, { status: 403 })
  }

  const admin = createAdminClient()
  await admin.from('orgs').update({ onboarding_tour_completed_at: new Date().toISOString() }).eq('id', orgId)

  return NextResponse.json({ ok: true })
}
