import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSuperAdmin } from '@/lib/org'

// Dev/testing affordance behind the Settings "Test onboarding" button: clears the org's
// onboarding_tour_completed_at so the owner first-run tour auto-fires again on /dashboard, exactly
// as a brand-new owner sees it. Double-gated - the caller must be the super-admin account AND the
// owner of the org - so it can never be triggered by a normal user against someone else's org.
export async function POST(request: Request) {
  const { orgId } = await request.json()
  if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isSuperAdmin(user.email)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (membership?.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 })

  const admin = createAdminClient()
  const { error } = await admin.from('orgs').update({ onboarding_tour_completed_at: null }).eq('id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
