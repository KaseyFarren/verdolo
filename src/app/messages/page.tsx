import AppShell from '@/components/AppShell'
import { requireOrgContext } from '@/lib/org'
import MessagesClient from './MessagesClient'

export default async function MessagesPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

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

  const [{ data: recentMessages }, { data: reads }] =
    allThreadIds.length > 0
      ? await Promise.all([
          supabase
            .from('messages')
            .select('thread_id, created_at')
            .in('thread_id', allThreadIds)
            .order('created_at', { ascending: false }),
          supabase.from('message_reads').select('thread_id, last_read_at').eq('user_id', user.id).in('thread_id', allThreadIds),
        ])
      : [{ data: [] }, { data: [] }]

  const lastMessageAtByThread: Record<string, string> = {}
  for (const row of recentMessages ?? []) {
    if (!lastMessageAtByThread[row.thread_id]) lastMessageAtByThread[row.thread_id] = row.created_at
  }
  const lastReadAtByThread = Object.fromEntries((reads ?? []).map((r) => [r.thread_id, r.last_read_at]))

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <MessagesClient
        orgId={orgId}
        userId={user.id}
        teamThreadId={teamThread?.id ?? null}
        members={members ?? []}
        dmThreadByUser={Object.fromEntries(dmThreadByUser)}
        lastMessageAtByThread={lastMessageAtByThread}
        lastReadAtByThread={lastReadAtByThread}
      />
    </AppShell>
  )
}
