import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/apiError'
import { inviterDetails, issueSetupLink, sendClientInviteEmail } from '@/lib/invites'

// Invites a client contact to the portal, or re-sends the setup email to one who hasn't finished
// yet (same call - the ClientPortalAccess "Resend" button posts the existing email again).
export async function POST(request: Request) {
  const { email: rawEmail, clientId, name } = await request.json()
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''

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

  const link = await issueSetupLink(admin, email)
  if ('error' in link || !link.userId) {
    return apiError('Could not create the invite link', 500, 'error' in link ? link.error : null)
  }

  // A teammate can't also be a client contact - they'd be bounced between the two apps.
  const { data: teamRow } = await admin.from('org_members').select('id').eq('user_id', link.userId).limit(1).maybeSingle()
  if (teamRow) {
    return NextResponse.json({ error: 'That email belongs to a Verdolo team account, so it can’t be a client contact.' }, { status: 400 })
  }

  const { data: existing } = await admin
    .from('client_users')
    .select('id, client_id, status, display_name')
    .eq('user_id', link.userId)
    .maybeSingle()

  if (existing && existing.client_id !== client.id) {
    return NextResponse.json({ error: 'That email is already a contact for another client.' }, { status: 400 })
  }
  if (existing?.status === 'active') {
    return NextResponse.json({ error: 'They’ve already set up their account - they can log in at app.verdolo.com.' }, { status: 400 })
  }

  if (!existing) {
    const { error: memberError } = await admin.from('client_users').insert({
      org_id: client.org_id,
      client_id: client.id,
      user_id: link.userId,
      status: 'invited',
      invited_email: email,
      display_name: name || null,
    })
    if (memberError) return apiError('Could not add the client contact', 500, memberError)
  } else if (name && !existing.display_name) {
    await admin.from('client_users').update({ display_name: name }).eq('id', existing.id)
  }

  const inviter = await inviterDetails(admin, client.org_id, user.id, user.email)
  const sent = await sendClientInviteEmail({
    to: email,
    url: link.url,
    contactName: name || existing?.display_name || null,
    clientName: client.name,
    inviterName: inviter.name,
    inviterEmail: inviter.email,
  })
  if (!sent) return NextResponse.json({ error: 'The invite was saved but the email could not be sent. Try Resend.' }, { status: 502 })

  return NextResponse.json({ ok: true, resent: !!existing })
}
