import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/apiError'

export async function POST(request: Request) {
  const { origin } = new URL(request.url)
  const { email, clientId, name } = await request.json()

  if (!email || !clientId) {
    return NextResponse.json({ error: 'email and clientId are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: client } = await supabase.from('clients').select('id, org_id, name').eq('id', clientId).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', client.org_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (membership?.role !== 'admin' && membership?.role !== 'owner') {
    return NextResponse.json({ error: 'Only admins can invite clients' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Same shared /accept-invite page as team invites (0067/0045) - it figures out which kind
  // of pending invite this user has via has_pending_invite() and accept_own_invite().
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/accept-invite`,
  })

  if (inviteError || !invited.user) {
    return apiError('Could not send the invite', 500, inviteError)
  }

  const { error: memberError } = await admin.from('client_users').insert({
    org_id: client.org_id,
    client_id: client.id,
    user_id: invited.user.id,
    status: 'invited',
    invited_email: email,
    display_name: name || null,
  })

  if (memberError) {
    return apiError('Could not add the client contact', 500, memberError)
  }

  return NextResponse.json({ ok: true })
}
