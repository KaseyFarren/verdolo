'use client'

import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'

type Message = { id: string; sender_id: string; body: string; created_at: string; deleted_at: string | null }

// Minimal two-party chat: no names/avatars (a client user has no RLS-visible path to org
// member profiles), just left/right bubbles by "is this me". No edit/delete/reactions/
// attachments - those live in the full team MessagesClient; this is the client-portal-facing
// slice of the same `messages` table and `can_access_thread()` policy.
export default function ThreadChat({ supabase, orgId, threadId, userId }: { supabase: SupabaseClient; orgId: string; threadId: string; userId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase
      .from('messages')
      .select('id, sender_id, body, created_at, deleted_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages((data as Message[]) ?? []))

    const channel = supabase
      .channel(`thread-${threadId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` }, (payload) => {
        const incoming = payload.new as Message
        setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, threadId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function send() {
    const trimmed = body.trim()
    if (!trimmed) return
    setSending(true)
    setBody('')
    const { error } = await supabase.from('messages').insert({ thread_id: threadId, org_id: orgId, sender_id: userId, body: trimmed })
    setSending(false)
    if (error) setBody(trimmed)
  }

  return (
    <div className="flex flex-col h-[28rem] rounded-2xl border border-ink/8 bg-white overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {messages.length === 0 && <p className="text-sm text-sage text-center my-auto">No messages yet - say hello.</p>}
        {messages
          .filter((m) => !m.deleted_at)
          .map((m) => {
            const mine = m.sender_id === userId
            return (
              <div key={m.id} className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${mine ? 'self-end bg-accent text-white' : 'self-start bg-sand text-ink'}`}>
                {m.body}
              </div>
            )
          })}
        <div ref={bottomRef} />
      </div>
      <div className="flex items-center gap-2 border-t border-ink/8 p-3">
        <input
          className="flex-1 rounded-full border border-ink/10 bg-white px-4 py-2 text-sm"
          placeholder="Message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
        />
        <Button variant="primary" size="sm" disabled={sending || !body.trim()} onClick={send}>
          Send
        </Button>
      </div>
    </div>
  )
}
