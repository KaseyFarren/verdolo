'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import ThreadChat from '@/components/ThreadChat'

// Resolves (or lazily creates) the one shared thread for a client, then hands off to the same
// ThreadChat a client user sees at /portal/messages - one thread, two audiences. Callers should
// pass key={clientId} so switching clients remounts this (fresh local state) instead of briefly
// showing the previous client's thread while the new one resolves.
export default function ClientChat({ supabase, orgId, userId, clientId }: { supabase: SupabaseClient; orgId: string; userId: string; clientId: string }) {
  const [threadId, setThreadId] = useState<string | null>(null)
  const [contactLabel, setContactLabel] = useState<string | undefined>(undefined)

  useEffect(() => {
    supabase.rpc('get_or_create_client_thread', { target_client_id: clientId }).then(({ data }) => setThreadId(data as string))
    // If the client has multiple contacts, this just picks one to label with - the thread
    // itself has no per-message sender identity here (see ThreadChat).
    supabase
      .from('client_users')
      .select('display_name, invited_email')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setContactLabel(data?.display_name || data?.invited_email || undefined))
  }, [supabase, clientId])

  if (!threadId) return <p className="text-sm text-sage py-2">Loading…</p>
  return <ThreadChat supabase={supabase} orgId={orgId} threadId={threadId} userId={userId} otherPartyLabel={contactLabel} />
}
