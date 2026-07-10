'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { wasSelfAssigned } from '@/lib/selfNotify'

// Plays a short ping when the current user is @mentioned in a message or assigned a task -
// mounted once in AppShell (persistent layout) so it fires regardless of which page is open.
export default function NotificationSound({ orgId, userId }: { orgId: string; userId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    audioRef.current = new Audio('/sounds/notification.mp3')
  }, [])

  useEffect(() => {
    const supabase = createClient()

    function ping() {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = 0
      // Browsers block audio until the tab has seen a user gesture - if that hasn't happened
      // yet (e.g. right after a fresh page load with no click), play() rejects; ignore it
      // rather than surface an error for something the user can't act on.
      audio.play().catch(() => {})
    }

    const channel = supabase
      .channel(`notifications-org-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as { sender_id: string; mentioned_user_ids: string[] | null }
        if (incoming.sender_id !== userId && incoming.mentioned_user_ids?.includes(userId)) ping()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as { id: string; assigned_to: string | null; is_auto: boolean }
        // Don't ping when you assign a task to yourself - only when someone else does.
        if (incoming.assigned_to === userId && !incoming.is_auto && !wasSelfAssigned(incoming.id)) ping()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as { id: string; assigned_to: string | null; is_auto: boolean }
        const previous = payload.old as { assigned_to: string | null }
        if (incoming.assigned_to === userId && previous.assigned_to !== userId && !incoming.is_auto && !wasSelfAssigned(incoming.id)) ping()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId, userId])

  return null
}
