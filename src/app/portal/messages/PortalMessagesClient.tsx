'use client'

import { useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import ThreadChat from '@/components/ThreadChat'

export default function PortalMessagesClient({ orgId, threadId, userId }: { orgId: string; threadId: string; userId: string }) {
  const supabase = useMemo(() => createClient(), [])
  return <ThreadChat supabase={supabase} orgId={orgId} threadId={threadId} userId={userId} otherPartyLabel="Team" />
}
