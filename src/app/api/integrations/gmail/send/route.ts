import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getValidGmailAccessToken } from '@/lib/googleAuth'
import { sendGmailMessage } from '@/lib/gmail'

export async function POST(request: Request) {
  const { clientId, threadId, subject, body } = await request.json()
  if (!clientId || !body) return NextResponse.json({ error: 'clientId and body are required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase.from('org_members').select('org_id').eq('user_id', user.id).eq('status', 'active').maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not a member of an org' }, { status: 403 })
  const orgId = membership.org_id

  const accessToken = await getValidGmailAccessToken(orgId, user.id)
  if (!accessToken) return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })

  const admin = createAdminClient()
  const { data: connection } = await admin
    .from('integration_connections')
    .select('external_account_id')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('provider', 'gmail')
    .single()
  const myEmail = connection?.external_account_id
  if (!myEmail) return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })

  let to: string
  let gmailThreadId: string | undefined
  let inReplyTo: string | undefined
  let internalThreadId: string | undefined

  if (threadId) {
    const { data: thread } = await admin.from('inbox_threads').select('*').eq('id', threadId).eq('org_id', orgId).single()
    if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
    to = thread.participant
    gmailThreadId = thread.external_thread_id
    internalThreadId = thread.id
    const { data: lastMsg } = await admin
      .from('inbox_messages')
      .select('rfc_message_id')
      .eq('thread_id', thread.id)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    inReplyTo = lastMsg?.rfc_message_id ?? undefined
  } else {
    const { data: client } = await supabase.from('clients').select('contact_email').eq('id', clientId).eq('org_id', orgId).single()
    if (!client?.contact_email) return NextResponse.json({ error: 'Client has no contact email' }, { status: 400 })
    to = client.contact_email
  }

  try {
    const result = await sendGmailMessage(accessToken, {
      to,
      from: myEmail,
      subject: subject || '(no subject)',
      body,
      threadId: gmailThreadId,
      inReplyTo,
      references: inReplyTo,
    })

    if (!internalThreadId) {
      const { data: newThread } = await admin
        .from('inbox_threads')
        .upsert(
          {
            org_id: orgId,
            client_id: clientId,
            provider: 'gmail',
            external_thread_id: result.threadId,
            participant: to,
            subject_or_channel: subject || '(no subject)',
            last_message_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,provider,external_thread_id' }
        )
        .select('id')
        .single()
      internalThreadId = newThread?.id
    } else {
      await admin.from('inbox_threads').update({ last_message_at: new Date().toISOString() }).eq('id', internalThreadId)
    }

    if (internalThreadId) {
      await admin.from('inbox_messages').insert({
        org_id: orgId,
        thread_id: internalThreadId,
        direction: 'out',
        sender: myEmail,
        body,
        sent_at: new Date().toISOString(),
        external_message_id: result.id,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Send failed' }, { status: 500 })
  }
}
