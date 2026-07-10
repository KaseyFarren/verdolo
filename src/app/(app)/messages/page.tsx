import { requireOrgContext } from '@/lib/org'
import MessagesClient from './MessagesClient'

export default async function MessagesPage() {
  const { supabase, user, orgId } = await requireOrgContext()

  const [{ data: teamThread }, { data: members }, { data: dmThreads }] = await Promise.all([
    supabase.from('message_threads').select('id').eq('org_id', orgId).eq('kind', 'team').single(),
    supabase
      .from('org_members')
      .select('user_id, invited_email, display_name, avatar_url')
      .eq('org_id', orgId)
      .eq('status', 'active'),
    supabase
      .from('message_thread_participants')
      .select('thread_id, message_threads!inner(id, kind, org_id)')
      .eq('user_id', user.id)
      .eq('message_threads.org_id', orgId),
  ])

  const dmThreadIds = (dmThreads ?? []).map((row) => row.thread_id)
  const { data: otherParticipants } =
    dmThreadIds.length > 0
      ? await supabase
          .from('message_thread_participants')
          .select('thread_id, user_id')
          .in('thread_id', dmThreadIds)
          .neq('user_id', user.id)
      : { data: [] }

  const dmThreadByUser = new Map<string, string>()
  for (const row of otherParticipants ?? []) {
    dmThreadByUser.set(row.user_id, row.thread_id)
  }

  const allThreadIds = [teamThread?.id, ...dmThreadIds].filter((id): id is string => Boolean(id))

  // last-message and last-mention per thread are denormalized (message_threads.last_message_at,
  // message_mentions) so this stays bounded by thread/mention count instead of scanning every
  // message ever sent - see supabase/migrations/0046_message_thread_activity.sql
  const [{ data: threadActivity }, { data: reads }, { data: mentionRows }] =
    allThreadIds.length > 0
      ? await Promise.all([
          supabase.from('message_threads').select('id, last_message_at').in('id', allThreadIds),
          supabase.from('message_reads').select('thread_id, last_read_at').eq('user_id', user.id).in('thread_id', allThreadIds),
          supabase
            .from('message_mentions')
            .select('thread_id, created_at')
            .eq('user_id', user.id)
            .in('thread_id', allThreadIds)
            .order('created_at', { ascending: false }),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }]

  const lastMessageAtByThread: Record<string, string> = {}
  for (const row of threadActivity ?? []) {
    if (row.last_message_at) lastMessageAtByThread[row.id] = row.last_message_at
  }
  const lastReadAtByThread = Object.fromEntries((reads ?? []).map((r) => [r.thread_id, r.last_read_at]))

  const lastMentionAtByThread: Record<string, string> = {}
  for (const row of mentionRows ?? []) {
    if (!lastMentionAtByThread[row.thread_id]) lastMentionAtByThread[row.thread_id] = row.created_at
  }

  return (
    <MessagesClient
      orgId={orgId}
      userId={user.id}
      teamThreadId={teamThread?.id ?? null}
      members={members ?? []}
      dmThreadByUser={Object.fromEntries(dmThreadByUser)}
      lastMessageAtByThread={lastMessageAtByThread}
      lastReadAtByThread={lastReadAtByThread}
      lastMentionAtByThread={lastMentionAtByThread}
    />
  )
}
