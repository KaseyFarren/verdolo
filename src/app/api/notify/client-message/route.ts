import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { sendEmail } from '@/lib/email'

// Fired client-side by ThreadChat right after a client sends a message (see
// otherPartyLabel/notifyTeamOnSend in ThreadChat.tsx) - best-effort, so a failed/skipped send
// here never blocks the message itself, which is already committed by the time this runs.
export async function POST(request: Request) {
  const { clientId } = await request.json()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Only the client themself can trigger their own thread's alert - client_users_select
  // permits user_id = auth.uid() regardless of org membership, so this doubles as the auth check.
  const { data: membership } = await supabase
    .from('client_users')
    .select('client_id')
    .eq('user_id', user.id)
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  // At most one email per client thread per 10 minutes, regardless of how many messages land
  // in that window - a rapid back-and-forth shouldn't turn into an inbox flood.
  const allowed = await rateLimit(`client-message-alert:${clientId}`, 1, 600)
  if (!allowed) return NextResponse.json({ ok: true, skipped: true })

  const admin = createAdminClient()
  const { data: client } = await admin.from('clients').select('name, org_id').eq('id', clientId).maybeSingle()
  if (!client) return NextResponse.json({ ok: true })

  const { data: members } = await admin
    .from('org_members')
    .select('invited_email')
    .eq('org_id', client.org_id)
    .eq('status', 'active')
    .not('invited_email', 'is', null)

  const recipients = (members ?? []).map((m) => m.invited_email).filter((e): e is string => Boolean(e))
  if (recipients.length === 0) return NextResponse.json({ ok: true })

  const { origin } = new URL(request.url)
  try {
    await sendEmail({
      to: recipients,
      subject: `New message from ${client.name}`,
      text: `${client.name} sent a new message in Verdolo.\n\nReply here: ${origin}/messages`,
    })
  } catch (err) {
    console.error('[notify/client-message] send failed:', err)
  }

  return NextResponse.json({ ok: true })
}
