'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { getInitials, memberName } from '@/lib/agency'
import { FileIcon, ImageFileIcon, PaperclipIcon, PdfFileIcon, SheetFileIcon, XIcon } from '@/components/ui/icons'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '✅']
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const PAGE_SIZE = 50

type Member = {
  user_id: string
  invited_email: string | null
  display_name: string | null
  avatar_url: string | null
}

type Reaction = { id: string; emoji: string; user_id: string }

type Message = {
  id: string
  thread_id: string
  sender_id: string
  body: string
  created_at: string
  attachment_path: string | null
  attachment_name: string | null
  attachment_type: string | null
  attachment_size_bytes: number | null
  attachment_signed_url?: string | null
  mentioned_user_ids: string[]
  reactions: Reaction[]
}

// Matches a trailing "@partial" token at the end of the draft - mentions can only be composed
// at the end of the input (a plain single-line <input>, not a cursor-aware textarea), which
// covers the common "type @ then a name" flow without needing mid-string cursor tracking.
const MENTION_TRIGGER = /(?:^|\s)@(\w*)$/
const ALL_MENTION_ID = 'all'
const ALL_MENTION_NAME = 'all'

type MentionOption = { id: string; name: string; avatar_url?: string | null; isAll?: boolean }

function formatFileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function extOf(fileName: string) {
  const i = fileName.lastIndexOf('.')
  return i === -1 ? '' : fileName.slice(i + 1).toLowerCase()
}

function AttachmentTypeIcon({ fileName, size }: { fileName: string; size: number }) {
  const ext = extOf(fileName)
  if (ext === 'pdf') return <PdfFileIcon size={size} />
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return <ImageFileIcon size={size} />
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return <SheetFileIcon size={size} />
  return <FileIcon size={size} />
}

function dateLabel(dateStr: string) {
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (target.getTime() === today.getTime()) return 'Today'
  if (target.getTime() === yesterday.getTime()) return 'Yesterday'
  return target.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: target.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  })
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function patchMessage(
  byThread: Record<string, Message[]>,
  threadId: string,
  messageId: string,
  update: (m: Message) => Message
) {
  const list = byThread[threadId]
  if (!list) return byThread
  return { ...byThread, [threadId]: list.map((m) => (m.id === messageId ? update(m) : m)) }
}

export default function MessagesClient({
  orgId,
  userId,
  teamThreadId,
  members,
  dmThreadByUser,
  lastMessageAtByThread: initialLastMessageAt,
  lastReadAtByThread: initialLastReadAt,
  lastMentionAtByThread: initialLastMentionAt,
}: {
  orgId: string
  userId: string
  teamThreadId: string | null
  members: Member[]
  dmThreadByUser: Record<string, string>
  lastMessageAtByThread: Record<string, string>
  lastReadAtByThread: Record<string, string>
  lastMentionAtByThread: Record<string, string>
}) {
  const supabase = useMemo(() => createClient(), [])
  const memberMap = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members])
  const contacts = useMemo(() => members.filter((m) => m.user_id !== userId), [members, userId])

  const [dmThreads, setDmThreads] = useState(dmThreadByUser)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(teamThreadId)
  const [activeContactId, setActiveContactId] = useState<string | null>(null)
  const [messagesByThread, setMessagesByThread] = useState<Record<string, Message[]>>({})
  const [hasMoreOlderByThread, setHasMoreOlderByThread] = useState<Record<string, boolean>>({})
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [lastMessageAtByThread, setLastMessageAtByThread] = useState(initialLastMessageAt)
  const [lastReadAtByThread, setLastReadAtByThread] = useState(initialLastReadAt)
  const [lastMentionAtByThread, setLastMentionAtByThread] = useState(initialLastMentionAt)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [mentionCandidates, setMentionCandidates] = useState<MentionOption[]>([])
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeThreadIdRef = useRef(activeThreadId)
  const loadedThreads = useRef(new Set<string>())
  const messagesByThreadRef = useRef(messagesByThread)
  const isLoadingOlderRef = useRef(false)

  useEffect(() => {
    messagesByThreadRef.current = messagesByThread
  }, [messagesByThread])

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId
  }, [activeThreadId])

  const markRead = useCallback(
    (threadId: string) => {
      const now = new Date().toISOString()
      setLastReadAtByThread((prev) => ({ ...prev, [threadId]: now }))
      supabase.from('message_reads').upsert({ thread_id: threadId, user_id: userId, last_read_at: now }, { onConflict: 'thread_id,user_id' }).then()
    },
    [supabase, userId]
  )

  const resolveImageAttachments = useCallback(
    async (threadId: string, msgs: Message[]) => {
      const imagePaths = msgs.filter((m) => m.attachment_path && m.attachment_type?.startsWith('image/')).map((m) => m.attachment_path!)
      if (imagePaths.length === 0) return
      const { data } = await supabase.storage.from('message-attachments').createSignedUrls(imagePaths, 3600)
      if (!data) return
      const urlByPath = new Map(data.map((d) => [d.path, d.signedUrl]))
      setMessagesByThread((prev) => {
        const list = prev[threadId]
        if (!list) return prev
        return {
          ...prev,
          [threadId]: list.map((m) =>
            m.attachment_path && urlByPath.has(m.attachment_path) ? { ...m, attachment_signed_url: urlByPath.get(m.attachment_path) } : m
          ),
        }
      })
    },
    [supabase]
  )

  const fetchReactionsFor = useCallback(
    async (messageIds: string[]) => {
      if (!messageIds.length) return new Map<string, Reaction[]>()
      const { data: reactions } = await supabase.from('message_reactions').select('id, message_id, emoji, user_id').in('message_id', messageIds)
      const reactionsByMessage = new Map<string, Reaction[]>()
      for (const r of reactions ?? []) {
        const list = reactionsByMessage.get(r.message_id) ?? []
        list.push({ id: r.id, emoji: r.emoji, user_id: r.user_id })
        reactionsByMessage.set(r.message_id, list)
      }
      return reactionsByMessage
    },
    [supabase]
  )

  // Loads only the latest PAGE_SIZE messages - a long-lived thread's full history used to be
  // fetched on every open, which only gets slower as a thread grows. "Load older" (below) pages
  // further back on demand instead.
  const loadThread = useCallback(
    async (threadId: string) => {
      setLoading(true)
      const { data: msgs } = await supabase
        .from('messages')
        .select(
          'id, thread_id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size_bytes, mentioned_user_ids'
        )
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      const ordered = (msgs ?? []).slice().reverse()
      const reactionsByMessage = await fetchReactionsFor(ordered.map((m) => m.id))
      const full: Message[] = ordered.map((m) => ({ ...m, reactions: reactionsByMessage.get(m.id) ?? [] }))
      loadedThreads.current.add(threadId)
      setMessagesByThread((prev) => ({ ...prev, [threadId]: full }))
      setHasMoreOlderByThread((prev) => ({ ...prev, [threadId]: (msgs ?? []).length >= PAGE_SIZE }))
      setLoading(false)
      resolveImageAttachments(threadId, full)
    },
    [supabase, fetchReactionsFor, resolveImageAttachments]
  )

  const loadOlderMessages = useCallback(
    async (threadId: string) => {
      const oldest = messagesByThreadRef.current[threadId]?.[0]
      if (!oldest || loadingOlder) return
      setLoadingOlder(true)
      isLoadingOlderRef.current = true
      const container = scrollRef.current
      const prevScrollHeight = container?.scrollHeight ?? 0

      const { data: msgs } = await supabase
        .from('messages')
        .select(
          'id, thread_id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size_bytes, mentioned_user_ids'
        )
        .eq('thread_id', threadId)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      const ordered = (msgs ?? []).slice().reverse()
      const reactionsByMessage = await fetchReactionsFor(ordered.map((m) => m.id))
      const older: Message[] = ordered.map((m) => ({ ...m, reactions: reactionsByMessage.get(m.id) ?? [] }))

      setMessagesByThread((prev) => ({ ...prev, [threadId]: [...older, ...(prev[threadId] ?? [])] }))
      setHasMoreOlderByThread((prev) => ({ ...prev, [threadId]: older.length >= PAGE_SIZE }))
      resolveImageAttachments(threadId, older)

      requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - prevScrollHeight
        isLoadingOlderRef.current = false
        setLoadingOlder(false)
      })
    },
    [supabase, fetchReactionsFor, resolveImageAttachments, loadingOlder]
  )

  useEffect(() => {
    if (!activeThreadId) return
    if (!loadedThreads.current.has(activeThreadId)) {
      loadThread(activeThreadId)
    } else {
      setLoading(false)
    }
    markRead(activeThreadId)
  }, [activeThreadId, loadThread, markRead])

  useEffect(() => {
    const channel = supabase
      .channel(`messages-org-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `org_id=eq.${orgId}` }, (payload) => {
        const incoming = payload.new as Omit<Message, 'reactions'>
        const withReactions: Message = { ...incoming, reactions: [] }
        setLastMessageAtByThread((prev) => ({ ...prev, [incoming.thread_id]: incoming.created_at }))
        if (incoming.mentioned_user_ids?.includes(userId)) {
          setLastMentionAtByThread((prev) => ({ ...prev, [incoming.thread_id]: incoming.created_at }))
        }
        setMessagesByThread((prev) => {
          if (!loadedThreads.current.has(incoming.thread_id)) return prev
          const list = prev[incoming.thread_id] ?? []
          if (list.some((m) => m.id === incoming.id)) return prev
          return { ...prev, [incoming.thread_id]: [...list, withReactions] }
        })
        if (incoming.attachment_path && incoming.attachment_type?.startsWith('image/')) {
          resolveImageAttachments(incoming.thread_id, [withReactions])
        }
        if (incoming.thread_id === activeThreadIdRef.current) {
          markRead(incoming.thread_id)
        }
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `org_id=eq.${orgId}` },
        (payload) => {
          const r = payload.new as { id: string; message_id: string; thread_id: string; emoji: string; user_id: string }
          setMessagesByThread((prev) =>
            patchMessage(prev, r.thread_id, r.message_id, (m) =>
              m.reactions.some((x) => x.id === r.id) ? m : { ...m, reactions: [...m.reactions, { id: r.id, emoji: r.emoji, user_id: r.user_id }] }
            )
          )
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions', filter: `org_id=eq.${orgId}` },
        (payload) => {
          const old = payload.old as { id: string; thread_id: string; message_id: string }
          setMessagesByThread((prev) =>
            patchMessage(prev, old.thread_id, old.message_id, (m) => ({ ...m, reactions: m.reactions.filter((x) => x.id !== old.id) }))
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, supabase])

  useEffect(() => {
    if (isLoadingOlderRef.current) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messagesByThread, activeThreadId])

  function unread(threadId: string | null | undefined) {
    if (!threadId) return false
    const lastMessage = lastMessageAtByThread[threadId]
    if (!lastMessage) return false
    const lastRead = lastReadAtByThread[threadId]
    return !lastRead || new Date(lastRead) < new Date(lastMessage)
  }

  function hasUnreadMention(threadId: string | null | undefined) {
    if (!threadId) return false
    const lastMention = lastMentionAtByThread[threadId]
    if (!lastMention) return false
    const lastRead = lastReadAtByThread[threadId]
    return !lastRead || new Date(lastRead) < new Date(lastMention)
  }

  function openTeamChannel() {
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
    if ((!body && !pendingFile) || !activeThreadId || sending) return
    setSending(true)

    let attachment: Pick<Message, 'attachment_path' | 'attachment_name' | 'attachment_type' | 'attachment_size_bytes'> | null = null
    if (pendingFile) {
      const path = `${activeThreadId}/${Date.now()}-${pendingFile.name}`
      const { error: uploadError } = await supabase.storage.from('message-attachments').upload(path, pendingFile)
      if (uploadError) {
        toast.error('File upload failed')
        setSending(false)
        return
      }
      attachment = {
        attachment_path: path,
        attachment_name: pendingFile.name,
        attachment_type: pendingFile.type || null,
        attachment_size_bytes: pendingFile.size,
      }
    }

    const mentionedUserIds = new Set<string>()
    for (const c of mentionCandidates) {
      if (!body.includes(`@${c.name}`)) continue
      if (c.id === ALL_MENTION_ID) {
        if (activeIsTeam) {
          for (const m of members) if (m.user_id !== userId) mentionedUserIds.add(m.user_id)
        } else if (activeContactId) {
          mentionedUserIds.add(activeContactId)
        }
      } else {
        mentionedUserIds.add(c.id)
      }
    }

    setDraft('')
    setPendingFile(null)
    setMentionCandidates([])
    const { data, error } = await supabase
      .from('messages')
      .insert({ thread_id: activeThreadId, org_id: orgId, sender_id: userId, body, mentioned_user_ids: [...mentionedUserIds], ...(attachment ?? {}) })
      .select()
      .single()
    setSending(false)
    if (error) {
      toast.error('Message failed to send')
      setDraft(body)
      return
    }
    const full: Message = { ...(data as Omit<Message, 'reactions'>), reactions: [] }
    setMessagesByThread((prev) => {
      const list = prev[activeThreadId] ?? []
      if (list.some((m) => m.id === full.id)) return prev
      return { ...prev, [activeThreadId]: [...list, full] }
    })
    if (full.attachment_path && full.attachment_type?.startsWith('image/')) {
      resolveImageAttachments(activeThreadId, [full])
    }
    markRead(activeThreadId)
  }

  async function toggleReaction(message: Message, emoji: string) {
    if (!activeThreadId) return
    const mine = message.reactions.find((r) => r.emoji === emoji && r.user_id === userId)
    if (mine) {
      setMessagesByThread((prev) =>
        patchMessage(prev, activeThreadId, message.id, (m) => ({ ...m, reactions: m.reactions.filter((r) => r.id !== mine.id) }))
      )
      await supabase.from('message_reactions').delete().eq('id', mine.id)
    } else {
      const { data, error } = await supabase
        .from('message_reactions')
        .insert({ message_id: message.id, thread_id: activeThreadId, org_id: orgId, user_id: userId, emoji })
        .select()
        .single()
      if (!error && data) {
        setMessagesByThread((prev) =>
          patchMessage(prev, activeThreadId, message.id, (m) =>
            m.reactions.some((r) => r.id === data.id) ? m : { ...m, reactions: [...m.reactions, { id: data.id, emoji: data.emoji, user_id: data.user_id }] }
          )
        )
      } else if (error) {
        toast.error('Could not add reaction')
      }
    }
  }

  async function openAttachment(m: Message) {
    if (!m.attachment_path) return
    const { data, error } = await supabase.storage.from('message-attachments').createSignedUrl(m.attachment_path, 60)
    if (error || !data) {
      toast.error('Could not open file')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  function senderLabel(senderId: string) {
    if (senderId === userId) return 'You'
    return memberName(memberMap.get(senderId))
  }

  function senderAvatar(senderId: string) {
    return memberMap.get(senderId)?.avatar_url ?? null
  }

  function insertMention(option: MentionOption) {
    setDraft((prev) => prev.replace(MENTION_TRIGGER, (m) => (m.startsWith(' ') ? ' ' : '') + `@${option.name} `))
    setMentionCandidates((prev) => [...prev, option])
  }

  // Splits a message body on any mentioned member's "@Name" (longest names first, so "Sam" can't
  // shadow a match inside "Sam Osei") plus a literal "@all" token, and wraps matches in a
  // highlighted span.
  function renderBody(m: Message) {
    if (!m.mentioned_user_ids?.length) return m.body
    const names = [...new Set(m.mentioned_user_ids.map((id) => memberName(memberMap.get(id))).filter((n) => n && n !== '-'))].sort(
      (a, b) => b.length - a.length
    )
    const hasAllToken = /(?:^|\s)@all\b/.test(m.body)
    const alternatives = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    if (hasAllToken) alternatives.unshift(ALL_MENTION_NAME)
    if (alternatives.length === 0) return m.body
    const pattern = new RegExp(`@(${alternatives.join('|')})\\b`, 'g')
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(m.body))) {
      if (match.index > lastIndex) parts.push(m.body.slice(lastIndex, match.index))
      parts.push(
        <span key={match.index} className={`font-semibold ${m.sender_id === userId ? 'text-white' : 'text-accent'}`}>
          @{match[1]}
        </span>
      )
      lastIndex = match.index + match[0].length
    }
    parts.push(m.body.slice(lastIndex))
    return parts
  }

  const activeIsTeam = activeThreadId === teamThreadId
  const messages = (activeThreadId && messagesByThread[activeThreadId]) || []
  const mentionMatch = draft.match(MENTION_TRIGGER)
  const mentionQuery = mentionMatch?.[1] ?? null
  const mentionResults: MentionOption[] =
    mentionQuery !== null
      ? [
          ...(ALL_MENTION_NAME.includes(mentionQuery.toLowerCase()) || 'everyone'.includes(mentionQuery.toLowerCase())
            ? [{ id: ALL_MENTION_ID, name: ALL_MENTION_NAME, isAll: true }]
            : []),
          ...contacts
            .filter((c) => memberName(c).toLowerCase().includes(mentionQuery.toLowerCase()))
            .map((c) => ({ id: c.user_id, name: memberName(c), avatar_url: c.avatar_url })),
        ]
      : []

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
            <span className="flex-1">Team</span>
            {!activeIsTeam && hasUnreadMention(teamThreadId) && (
              <span className="h-4 w-4 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center shrink-0">@</span>
            )}
            {!activeIsTeam && !hasUnreadMention(teamThreadId) && unread(teamThreadId) && (
              <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
            )}
          </button>

          <div className="px-3 pt-3 pb-1 text-xs font-medium text-sage uppercase tracking-wide">Direct messages</div>
          {contacts.length === 0 && <div className="px-3 py-2 text-xs text-sage">No other teammates yet</div>}
          {contacts.map((c) => {
            const active = !activeIsTeam && activeContactId === c.user_id
            const threadId = dmThreads[c.user_id]
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
                <span className="truncate flex-1">{memberName(c)}</span>
                {!active && hasUnreadMention(threadId) && (
                  <span className="h-4 w-4 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center shrink-0">@</span>
                )}
                {!active && !hasUnreadMention(threadId) && unread(threadId) && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
              </button>
            )
          })}
        </aside>

        <section className="flex-1 rounded-2xl bg-white shadow-md flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-1">
            {loading && <div className="text-sm text-sage">Loading…</div>}
            {!loading && messages.length === 0 && (
              <div className="text-sm text-sage">No messages yet. Say hi 👋</div>
            )}
            {!loading && activeThreadId && hasMoreOlderByThread[activeThreadId] && (
              <button
                onClick={() => loadOlderMessages(activeThreadId)}
                disabled={loadingOlder}
                className="w-full text-center text-xs text-sage hover:text-ink py-2 disabled:opacity-50"
              >
                {loadingOlder ? 'Loading…' : 'Load older messages'}
              </button>
            )}
            {messages.map((m, i) => {
              const own = m.sender_id === userId
              const avatar = senderAvatar(m.sender_id)
              const showDateSeparator = i === 0 || !sameDay(messages[i - 1].created_at, m.created_at)
              const reactionGroups = new Map<string, Reaction[]>()
              for (const r of m.reactions) {
                reactionGroups.set(r.emoji, [...(reactionGroups.get(r.emoji) ?? []), r])
              }

              return (
                <div key={m.id}>
                  {showDateSeparator && (
                    <div className="flex items-center justify-center my-3">
                      <span className="text-xs text-sage bg-sand rounded-full px-3 py-1">{dateLabel(m.created_at)}</span>
                    </div>
                  )}
                  <div className={`group flex gap-2 py-1.5 ${own ? 'justify-end' : 'justify-start'}`}>
                    {!own &&
                      (avatar ? (
                        <img src={avatar} alt="" className="h-6 w-6 rounded-full object-cover shrink-0 self-end" />
                      ) : (
                        <span className="h-6 w-6 rounded-full bg-green/15 text-green text-[10px] font-medium flex items-center justify-center shrink-0 self-end">
                          {getInitials(senderLabel(m.sender_id))}
                        </span>
                      ))}
                    <div className={`max-w-[75%] ${own ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                      <span className="text-xs text-sage px-1">{senderLabel(m.sender_id)}</span>
                      <div className="relative">
                        <div
                          className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                            own ? 'bg-accent text-white' : 'bg-sand text-ink'
                          }`}
                        >
                          {m.body && <div>{renderBody(m)}</div>}
                          {m.attachment_path &&
                            (m.attachment_type?.startsWith('image/') ? (
                              m.attachment_signed_url ? (
                                <img
                                  src={m.attachment_signed_url}
                                  alt={m.attachment_name ?? ''}
                                  className={`rounded-lg max-w-[220px] max-h-[220px] object-cover cursor-pointer ${m.body ? 'mt-2' : ''}`}
                                  onClick={() => openAttachment(m)}
                                />
                              ) : (
                                <div className={`text-xs opacity-70 ${m.body ? 'mt-2' : ''}`}>Loading image…</div>
                              )
                            ) : (
                              <button
                                onClick={() => openAttachment(m)}
                                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                                  own ? 'bg-white/15 hover:bg-white/25' : 'bg-white hover:shadow-sm'
                                } ${m.body ? 'mt-2' : ''}`}
                              >
                                <AttachmentTypeIcon fileName={m.attachment_name ?? ''} size={16} />
                                <span className="flex flex-col leading-tight">
                                  <span className="text-xs font-medium truncate max-w-[140px]">{m.attachment_name}</span>
                                  <span className={`text-[10px] ${own ? 'opacity-70' : 'text-sage'}`}>{formatFileSize(m.attachment_size_bytes)}</span>
                                </span>
                              </button>
                            ))}
                        </div>

                        <div
                          className={`absolute top-0 hidden group-hover:flex items-center gap-0.5 bg-white shadow-md rounded-full px-1.5 py-1 z-10 ${
                            own ? 'right-full mr-1' : 'left-full ml-1'
                          }`}
                        >
                          {QUICK_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => toggleReaction(m, emoji)}
                              className="text-sm leading-none hover:scale-125 transition-transform"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>

                      {reactionGroups.size > 0 && (
                        <div className="flex flex-wrap gap-1 px-1">
                          {[...reactionGroups.entries()].map(([emoji, reacts]) => {
                            const mine = reacts.some((r) => r.user_id === userId)
                            return (
                              <button
                                key={emoji}
                                onClick={() => toggleReaction(m, emoji)}
                                className={`text-xs rounded-full px-1.5 py-0.5 border flex items-center gap-1 ${
                                  mine ? 'bg-accent/10 border-accent text-accent' : 'bg-sand border-transparent text-ink'
                                }`}
                              >
                                <span>{emoji}</span>
                                <span>{reacts.length}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}

                      <span className="text-[10px] text-sage px-1">
                        {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {pendingFile && (
            <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-sand px-2.5 py-1.5 text-xs">
              <AttachmentTypeIcon fileName={pendingFile.name} size={14} />
              <span className="truncate flex-1">{pendingFile.name}</span>
              <span className="text-sage">{formatFileSize(pendingFile.size)}</span>
              <button onClick={() => setPendingFile(null)} className="text-sage hover:text-ink">
                <XIcon size={13} />
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
            className="border-t border-ink/10 p-3 flex gap-2 items-center"
          >
            <label className="shrink-0 text-sage hover:text-ink cursor-pointer p-1.5">
              <PaperclipIcon size={18} />
              <input
                type="file"
                className="hidden"
                disabled={sending}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    if (file.size > MAX_ATTACHMENT_BYTES) {
                      toast.error(`That file is too large - attachments are limited to ${formatFileSize(MAX_ATTACHMENT_BYTES)}`)
                    } else {
                      setPendingFile(file)
                    }
                  }
                  e.target.value = ''
                }}
              />
            </label>
            <div className="relative flex-1">
              {mentionQuery !== null && mentionResults.length > 0 && (
                <div className="absolute bottom-full mb-1 left-0 w-56 max-h-48 overflow-y-auto rounded-lg border border-ink/10 bg-white shadow-md py-1 z-10">
                  {mentionResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => insertMention(c)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-sand flex items-center gap-2"
                    >
                      {c.isAll ? (
                        <span className="h-5 w-5 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center shrink-0">
                          @
                        </span>
                      ) : c.avatar_url ? (
                        <img src={c.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" />
                      ) : (
                        <span className="h-5 w-5 rounded-full bg-green/15 text-green text-[10px] font-medium flex items-center justify-center shrink-0">
                          {getInitials(c.name)}
                        </span>
                      )}
                      <span className="truncate">{c.isAll ? 'Everyone' : c.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && mentionQuery !== null && mentionResults.length > 0) {
                    e.preventDefault()
                    insertMention(mentionResults[0])
                  }
                }}
                placeholder={activeIsTeam ? 'Message the team… (@ to mention)' : 'Type a message…'}
                className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:border-accent"
                disabled={!activeThreadId}
              />
            </div>
            <button
              type="submit"
              disabled={(!draft.trim() && !pendingFile) || !activeThreadId || sending}
              className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:pointer-events-none hover:brightness-110 transition"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
