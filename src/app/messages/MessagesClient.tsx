'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { getInitials, memberName } from '@/lib/agency'

type Member = {
  user_id: string
  invited_email: string | null
  display_name: string | null
  avatar_url: string | null
}

type Message = {
  id: string
  thread_id: string
  sender_id: string
  body: string
  created_at: string
}

export default function MessagesClient({
  orgId,
  userId,
  teamThreadId,
  members,
  dmThreadByUser,
}: {
  orgId: string
  userId: string
  teamThreadId: string | null
  members: Member[]
  dmThreadByUser: Record<string, string>
}) {
  const supabase = useMemo(() => createClient(), [])
  const memberMap = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members])
  const contacts = useMemo(() => members.filter((m) => m.user_id !== userId), [members, userId])

  const [dmThreads, setDmThreads] = useState(dmThreadByUser)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(teamThreadId)
  const [activeContactId, setActiveContactId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeThreadId) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('messages')
      .select('id, thread_id, sender_id, body, created_at')
      .eq('thread_id', activeThreadId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setMessages(data ?? [])
        setLoading(false)
      })

    const channel = supabase
      .channel(`messages-thread-${activeThreadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${activeThreadId}` },
        (payload) => {
          const incoming = payload.new as Message
          setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]))
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [activeThreadId, supabase])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  async function openTeamChannel() {
    setActiveContactId(null)
    setActiveThreadId(teamThreadId)
  }

  async function openDm(contact: Member) {
    setActiveContactId(contact.user_id)
    const existing = dmThreads[contact.user_id]
    if (existing) {
      setActiveThreadId(existing)
      return
    }
    const { data, error } = await supabase.rpc('get_or_create_dm_thread', { other_user_id: contact.user_id })
    if (error || !data) {
      toast.error('Could not open that conversation')
      return
    }
    setDmThreads((prev) => ({ ...prev, [contact.user_id]: data }))
    setActiveThreadId(data)
  }

  async function send() {
    const body = draft.trim()
    if (!body || !activeThreadId || sending) return
    setSending(true)
    setDraft('')
    const { data, error } = await supabase
      .from('messages')
      .insert({ thread_id: activeThreadId, org_id: orgId, sender_id: userId, body })
      .select()
      .single()
    setSending(false)
    if (error) {
      toast.error('Message failed to send')
      setDraft(body)
      return
    }
    setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data as Message]))
  }

  function senderLabel(senderId: string) {
    if (senderId === userId) return 'You'
    return memberName(memberMap.get(senderId))
  }

  function senderAvatar(senderId: string) {
    return memberMap.get(senderId)?.avatar_url ?? null
  }

  const activeIsTeam = activeThreadId === teamThreadId

  return (
    <div className="mb-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <p className="text-sm text-sage">Team chat and direct messages</p>
      </div>

      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[420px]">
        <aside className="w-48 shrink-0 rounded-2xl bg-white shadow-md p-2 overflow-y-auto">
          <button
            onClick={openTeamChannel}
            className={`w-full text-left rounded-lg px-3 py-2 mb-1 text-sm flex items-center gap-2 transition-colors ${
              activeIsTeam ? 'bg-accent text-white font-medium' : 'text-ink hover:bg-sand'
            }`}
          >
            <span>💬</span>
            <span>Team</span>
          </button>

          <div className="px-3 pt-3 pb-1 text-xs font-medium text-sage uppercase tracking-wide">Direct messages</div>
          {contacts.length === 0 && <div className="px-3 py-2 text-xs text-sage">No other teammates yet</div>}
          {contacts.map((c) => {
            const active = !activeIsTeam && activeContactId === c.user_id
            return (
              <button
                key={c.user_id}
                onClick={() => openDm(c)}
                className={`w-full text-left rounded-lg px-3 py-2 mb-1 text-sm flex items-center gap-2 transition-colors ${
                  active ? 'bg-accent text-white font-medium' : 'text-ink hover:bg-sand'
                }`}
              >
                {c.avatar_url ? (
                  <img src={c.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="h-5 w-5 rounded-full bg-green/15 text-green text-[10px] font-medium flex items-center justify-center shrink-0">
                    {getInitials(memberName(c))}
                  </span>
                )}
                <span className="truncate">{memberName(c)}</span>
              </button>
            )
          })}
        </aside>

        <section className="flex-1 rounded-2xl bg-white shadow-md flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
            {loading && <div className="text-sm text-sage">Loading…</div>}
            {!loading && messages.length === 0 && (
              <div className="text-sm text-sage">No messages yet. Say hi 👋</div>
            )}
            {messages.map((m) => {
              const own = m.sender_id === userId
              const avatar = senderAvatar(m.sender_id)
              return (
                <div key={m.id} className={`flex gap-2 ${own ? 'justify-end' : 'justify-start'}`}>
                  {!own &&
                    (avatar ? (
                      <img src={avatar} alt="" className="h-6 w-6 rounded-full object-cover shrink-0 self-end" />
                    ) : (
                      <span className="h-6 w-6 rounded-full bg-green/15 text-green text-[10px] font-medium flex items-center justify-center shrink-0 self-end">
                        {getInitials(senderLabel(m.sender_id))}
                      </span>
                    ))}
                  <div className={`max-w-[75%] ${own ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                    {!own && <span className="text-xs text-sage px-1">{senderLabel(m.sender_id)}</span>}
                    <div
                      className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        own ? 'bg-accent text-white' : 'bg-sand text-ink'
                      }`}
                    >
                      {m.body}
                    </div>
                    <span className="text-[10px] text-sage px-1">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
            className="border-t border-ink/10 p-3 flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={activeIsTeam ? 'Message the team…' : 'Type a message…'}
              className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:border-accent"
              disabled={!activeThreadId}
            />
            <button
              type="submit"
              disabled={!draft.trim() || !activeThreadId || sending}
              className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:pointer-events-none hover:brightness-110 transition"
            >
              Send
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
