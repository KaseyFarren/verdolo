import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getValidGmailAccessToken } from '@/lib/googleAuth'
import { extractEmail, getMessage, listRecentMessageIds } from '@/lib/gmail'

function domainOf(email: string) {
  return email.split('@')[1]?.toLowerCase() ?? ''
}

export async function POST() {
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
  const myEmail = (connection?.external_account_id ?? '').toLowerCase()

  const { data: clients } = await supabase.from('clients').select('id, contact_email, contact_domain').eq('org_id', orgId)
  const byEmail = new Map((clients || []).filter((c) => c.contact_email).map((c) => [c.contact_email!.toLowerCase(), c.id]))
  const byDomain = new Map((clients || []).filter((c) => c.contact_domain).map((c) => [c.contact_domain!.toLowerCase(), c.id]))

  function matchClient(email: string) {
    return byEmail.get(email) ?? byDomain.get(domainOf(email)) ?? null
  }

  let matched = 0
  try {
    const ids = await listRecentMessageIds(accessToken, 30)
    const messages = await Promise.all(ids.map((m) => getMessage(accessToken, m.id)))

    for (const msg of messages) {
      const fromEmail = extractEmail(msg.from)
      const toEmail = extractEmail(msg.to)
      const outgoing = fromEmail === myEmail
      const counterpart = outgoing ? toEmail : fromEmail
      const clientId = matchClient(counterpart)
      if (!clientId) continue

      const { data: thread } = await admin
        .from('inbox_threads')
        .upsert(
          {
            org_id: orgId,
            client_id: clientId,
            provider: 'gmail',
            external_thread_id: msg.threadId,
            participant: counterpart,
            subject_or_channel: msg.subject,
            last_message_at: msg.date,
          },
          { onConflict: 'org_id,provider,external_thread_id' }
        )
        .select('id')
        .single()
      if (!thread) continue

      await admin.from('inbox_messages').upsert(
        {
          org_id: orgId,
          thread_id: thread.id,
          direction: outgoing ? 'out' : 'in',
          sender: msg.from,
          body: msg.snippet,
          sent_at: msg.date,
          external_message_id: msg.id,
          rfc_message_id: msg.messageId,
        },
        { onConflict: 'org_id,external_message_id' }
      )
      matched++
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sync failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, matched })
}
