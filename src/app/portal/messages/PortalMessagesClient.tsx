'use client'

import { useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import ThreadChat from '@/components/ThreadChat'

export default function PortalMessagesClient({ orgId, clientId, threadId, userId }: { orgId: string; clientId: string; threadId: string; userId: string }) {
  const supabase = useMemo(() => createClient(), [])
  return <ThreadChat supabase={supabase} orgId={orgId} threadId={threadId} userId={userId} otherPartyLabel="Team" notifyClientId={clientId} />
}
