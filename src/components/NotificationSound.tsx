'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { wasSelfAssigned } from '@/lib/selfNotify'

// Plays a short ping - and, if the user has granted permission, raises a browser desktop
// notification - when the current user is @mentioned in a message or assigned a task. Mounted
// once in AppShell (persistent layout) so it fires regardless of which page is open.
export default function NotificationSound({ orgId, userId }: { orgId: string; userId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const router = useRouter()

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

    // Only raise a desktop notification when the user has opted in (permission granted, done
    // from Settings > Profile) AND the tab isn't the one they're actively looking at - if it is,
    // the ping plus the live UI already tell them; a second OS-level popup would just be noise.
    function desktop(title: string, body: string, href: string) {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      if (typeof document !== 'undefined' && !document.hidden) return
      try {
        const n = new Notification(title, { body, icon: '/icon.png', tag: href })
        n.onclick = () => {
          window.focus()
          router.push(href)
          n.close()
        }
      } catch {
        // Some browsers throw if notifications are constructed outside a service worker on
        // mobile - nothing actionable, the ping still fired.
      }
    }

    function truncate(s: string, n = 120) {
      return s.length > n ? `${s.slice(0, n - 1)}…` : s
    }

    const channel = supabase
      .channel(`notifications-org-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as { sender_id: string; mentioned_user_ids: string[] | null; body: string }
        if (incoming.sender_id !== userId && incoming.mentioned_user_ids?.includes(userId)) {
          ping()
          desktop('You were mentioned', truncate(incoming.body || ''), '/messages')
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as { id: string; assigned_to: string | null; is_auto: boolean; title: string }
        // Don't ping when you assign a task to yourself - only when someone else does.
        if (incoming.assigned_to === userId && !incoming.is_auto && !wasSelfAssigned(incoming.id)) {
          ping()
          desktop('New task assigned to you', truncate(incoming.title || ''), '/tasks')
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as { id: string; assigned_to: string | null; is_auto: boolean; title: string }
        const previous = payload.old as { assigned_to: string | null }
        if (incoming.assigned_to === userId && previous.assigned_to !== userId && !incoming.is_auto && !wasSelfAssigned(incoming.id)) {
          ping()
          desktop('New task assigned to you', truncate(incoming.title || ''), '/tasks')
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId, userId, router])

  return null
}
