'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { getInitials, memberName } from '@/lib/agency'
import { FileIcon, ImageFileIcon, MessageCircleIcon, PaperclipIcon, PdfFileIcon, SheetFileIcon, XIcon } from '@/components/ui/icons'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '✅']
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const PAGE_SIZE = 50
const GROUP_WINDOW_MS = 5 * 60 * 1000

const MESSAGE_COLUMNS =
  'id, thread_id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size_bytes, mentioned_user_ids, parent_message_id, reply_count, last_reply_at'

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
  parent_message_id: string | null
  reply_count: number
  last_reply_at: string | null
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

function timeLabel(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function lastActivityLabel(dateStr: string) {
  return sameDay(dateStr, new Date().toISOString()) ? timeLabel(dateStr) : `${dateLabel(dateStr)} at ${timeLabel(dateStr)}`
}

// A message is a visual "continuation" of the previous row (no repeated avatar/name/timestamp)
// when it's the same sender, same day, and close enough in time - matches Slack's grouping.
function showDateSeparatorAt(list: Message[], i: number) {
  return i === 0 || !sameDay(list[i - 1].created_at, list[i].created_at)
}
function groupedAt(list: Message[], i: number, dateSeparator: boolean) {
  if (dateSeparator || i === 0) return false
  const prev = list[i - 1]
  const cur = list[i]
  if (prev.sender_id !== cur.sender_id) return false
  return new Date(cur.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS
}

function patchMessage(byThread: Record<string, Message[]>, threadId: string, messageId: string, update: (m: Message) => Message) {
  const list = byThread[threadId]
  if (!list || !list.some((m) => m.id === messageId)) return byThread
  return { ...byThread, [threadId]: list.map((m) => (m.id === messageId ? update(m) : m)) }
}

// Same idea as patchMessage but for the thread-panel store, which is keyed by parent message id
// rather than thread id - scans each open thread's reply list for the message being patched.
function patchReplyMessage(byParent: Record<string, Message[]>, messageId: string, update: (m: Message) => Message) {
  for (const [parentId, list] of Object.entries(byParent)) {
    if (list.some((m) => m.id === messageId)) {
      return { ...byParent, [parentId]: list.map((m) => (m.id === messageId ? update(m) : m)) }
    }
  }
  return byParent
}

function withResolvedAttachments(list: Message[], urlByPath: Map<string, string>) {
  return list.map((m) => (m.attachment_path && urlByPath.has(m.attachment_path) ? { ...m, attachment_signed_url: urlByPath.get(m.attachment_path) } : m))
}

function computeMentionResults(text: string, contacts: Member[]): MentionOption[] {
  const match = text.match(MENTION_TRIGGER)
  const query = match?.[1] ?? null
  if (query === null) return []
  return [
    ...(ALL_MENTION_NAME.includes(query.toLowerCase()) || 'everyone'.includes(query.toLowerCase())
      ? [{ id: ALL_MENTION_ID, name: ALL_MENTION_NAME, isAll: true }]
      : []),
    ...contacts.filter((c) => memberName(c).toLowerCase().includes(query.toLowerCase())).map((c) => ({ id: c.user_id, name: memberName(c), avatar_url: c.avatar_url })),
  ]
}

// Splits a message body on any mentioned member's "@Name" (longest names first, so "Sam" can't
// shadow a match inside "Sam Osei") plus a literal "@all" token, and wraps matches in a
// highlighted span.
function renderBody(m: Message, memberMap: Map<string, Member>) {
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
      <span key={match.index} className="font-semibold text-accent">
        @{match[1]}
      </span>
    )
    lastIndex = match.index + match[0].length
  }
  parts.push(m.body.slice(lastIndex))
  return parts
}

// Memoized so a reaction/mention update to ONE message doesn't force every other loaded message
// in the thread to re-render and recompute its reaction grouping + mention highlighting - state
// updates (send/react/realtime) only ever replace the object reference for the message that
// actually changed (see patchMessage above), so React.memo's default shallow prop comparison is
// enough to skip the rest.
const MessageRow = memo(function MessageRow({
  m,
  grouped,
  avatarUrl,
  senderName,
  showDateSeparator,
  userId,
  memberMap,
  showThreadIndicator,
  allowThreadReply,
  onToggleReaction,
  onOpenAttachment,
  onOpenThread,
}: {
  m: Message
  grouped: boolean
  avatarUrl: string | null
  senderName: string
  showDateSeparator: boolean
  userId: string
  memberMap: Map<string, Member>
  showThreadIndicator: boolean
  allowThreadReply: boolean
  onToggleReaction: (m: Message, emoji: string) => void
  onOpenAttachment: (m: Message) => void
  onOpenThread: (m: Message) => void
}) {
  const reactionGroups = useMemo(() => {
    const groups = new Map<string, Reaction[]>()
    for (const r of m.reactions) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r])
    return groups
  }, [m.reactions])

  const bodyNodes = useMemo(() => renderBody(m, memberMap), [m, memberMap])

  return (
    <div>
      {showDateSeparator && (
        <div className="flex items-center justify-center my-3">
          <span className="text-xs text-sage bg-sand rounded-full px-3 py-1">{dateLabel(m.created_at)}</span>
        </div>
      )}
      <div className={`group relative flex gap-2.5 px-2 rounded-lg hover:bg-sand/50 ${grouped ? 'py-0.5' : 'pt-2.5 pb-0.5'}`}>
        <div className="w-8 shrink-0 flex justify-center">
          {!grouped ? (
            avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
            ) : (
              <span className="h-8 w-8 rounded-full bg-green/15 text-green text-[11px] font-medium flex items-center justify-center shrink-0">
                {getInitials(senderName)}
              </span>
            )
          ) : (
            <span className="hidden group-hover:flex h-5 items-center justify-center text-[10px] text-sage w-8">{timeLabel(m.created_at)}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-ink">{senderName}</span>
              <span className="text-[11px] text-sage">{timeLabel(m.created_at)}</span>
            </div>
          )}

          {m.body && <div className="text-sm text-ink whitespace-pre-wrap break-words">{bodyNodes}</div>}

          {m.attachment_path &&
            (m.attachment_type?.startsWith('image/') ? (
              m.attachment_signed_url ? (
                <img
                  src={m.attachment_signed_url}
                  alt={m.attachment_name ?? ''}
                  className={`rounded-lg max-w-[220px] max-h-[220px] object-cover cursor-pointer ${m.body ? 'mt-1.5' : ''}`}
                  onClick={() => onOpenAttachment(m)}
                />
              ) : (
                <div className={`text-xs text-sage ${m.body ? 'mt-1.5' : ''}`}>Loading image…</div>
              )
            ) : (
              <button
                onClick={() => onOpenAttachment(m)}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left bg-sand hover:shadow-sm ${m.body ? 'mt-1.5' : ''}`}
              >
                <AttachmentTypeIcon fileName={m.attachment_name ?? ''} size={16} />
                <span className="flex flex-col leading-tight">
                  <span className="text-xs font-medium truncate max-w-[220px]">{m.attachment_name}</span>
                  <span className="text-[10px] text-sage">{formatFileSize(m.attachment_size_bytes)}</span>
                </span>
              </button>
            ))}

          {reactionGroups.size > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {[...reactionGroups.entries()].map(([emoji, reacts]) => {
                const mine = reacts.some((r) => r.user_id === userId)
                return (
                  <button
                    key={emoji}
                    onClick={() => onToggleReaction(m, emoji)}
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

          {showThreadIndicator && m.reply_count > 0 && (
            <button
              onClick={() => onOpenThread(m)}
              className="mt-1 flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              <MessageCircleIcon size={13} />
              <span className="font-medium">
                {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}
              </span>
              {m.last_reply_at && <span className="text-sage font-normal">Last reply {lastActivityLabel(m.last_reply_at)}</span>}
            </button>
          )}
        </div>

        <div className="absolute -top-3 right-2 hidden group-hover:flex items-center gap-0.5 bg-white shadow-md rounded-lg border border-ink/10 px-1 py-1 z-10">
          {QUICK_EMOJIS.map((emoji) => (
            <button key={emoji} onClick={() => onToggleReaction(m, emoji)} className="text-sm leading-none hover:scale-125 transition-transform px-0.5">
              {emoji}
            </button>
          ))}
          {allowThreadReply && (
            <>
              <span className="w-px h-4 bg-ink/10 mx-0.5" />
              <button onClick={() => onOpenThread(m)} title="Reply in thread" className="text-sage hover:text-ink px-0.5">
                <MessageCircleIcon size={15} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

function MessageComposer({
  draft,
  setDraft,
  pendingFile,
  setPendingFile,
  sending,
  onSubmit,
  mentionQuery,
  mentionResults,
  onInsertMention,
  placeholder,
  disabled,
}: {
  draft: string
  setDraft: React.Dispatch<React.SetStateAction<string>>
  pendingFile: File | null
  setPendingFile: (f: File | null) => void
  sending: boolean
  onSubmit: () => void
  mentionQuery: string | null
  mentionResults: MentionOption[]
  onInsertMention: (option: MentionOption) => void
  placeholder: string
  disabled: boolean
}) {
  return (
    <>
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
          onSubmit()
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
                  onClick={() => onInsertMention(c)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-sand flex items-center gap-2"
                >
                  {c.isAll ? (
                    <span className="h-5 w-5 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center shrink-0">@</span>
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
                onInsertMention(mentionResults[0])
              }
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:border-accent"
            disabled={disabled}
          />
        </div>
        <button
          type="submit"
          disabled={(!draft.trim() && !pendingFile) || disabled || sending}
          className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:pointer-events-none hover:brightness-110 transition"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </>
  )
}

type SidebarFilter = 'all' | 'unread' | 'mentions'

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
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>('all')

  const [openThreadParentId, setOpenThreadParentId] = useState<string | null>(null)
  const [repliesByParent, setRepliesByParent] = useState<Record<string, Message[]>>({})
  const [loadingThread, setLoadingThread] = useState(false)
  const [threadDraft, setThreadDraft] = useState('')
  const [threadMentionCandidates, setThreadMentionCandidates] = useState<MentionOption[]>([])
  const [threadPendingFile, setThreadPendingFile] = useState<File | null>(null)
  const [threadSending, setThreadSending] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const threadScrollRef = useRef<HTMLDivElement>(null)
  const activeThreadIdRef = useRef(activeThreadId)
  const loadedThreads = useRef(new Set<string>())
  const loadedThreadParents = useRef(new Set<string>())
  const messagesByThreadRef = useRef(messagesByThread)
  const isLoadingOlderRef = useRef(false)

  const activeIsTeam = activeThreadId === teamThreadId

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

  // Generic image-attachment resolver: fetches signed URLs then hands the map to whichever
  // store (main channel list or thread-panel replies) the caller wants patched.
  const resolveImageAttachments = useCallback(
    async (msgs: Message[], apply: (urlByPath: Map<string, string>) => void) => {
      const imagePaths = msgs.filter((m) => m.attachment_path && m.attachment_type?.startsWith('image/')).map((m) => m.attachment_path!)
      if (imagePaths.length === 0) return
      const { data } = await supabase.storage.from('message-attachments').createSignedUrls(imagePaths, 3600)
      if (!data) return
      apply(new Map(data.filter((d): d is typeof d & { path: string; signedUrl: string } => Boolean(d.path && d.signedUrl)).map((d) => [d.path, d.signedUrl])))
    },
    [supabase]
  )

  const resolveMainImageAttachments = useCallback(
    (threadId: string, msgs: Message[]) =>
      resolveImageAttachments(msgs, (urlByPath) =>
        setMessagesByThread((prev) => {
          const list = prev[threadId]
          if (!list) return prev
          return { ...prev, [threadId]: withResolvedAttachments(list, urlByPath) }
        })
      ),
    [resolveImageAttachments]
  )

  const resolveThreadImageAttachments = useCallback(
    (parentId: string, msgs: Message[]) =>
      resolveImageAttachments(msgs, (urlByPath) =>
        setRepliesByParent((prev) => {
          const list = prev[parentId]
          if (!list) return prev
          return { ...prev, [parentId]: withResolvedAttachments(list, urlByPath) }
        })
      ),
    [resolveImageAttachments]
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

  // Loads only the latest PAGE_SIZE top-level messages - a long-lived thread's full history used
  // to be fetched on every open, which only gets slower as a thread grows. "Load older" (below)
  // pages further back on demand instead. Replies are excluded here - they only load into the
  // thread panel when opened.
  const loadThread = useCallback(
    async (threadId: string) => {
      setLoading(true)
      const { data: msgs } = await supabase
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('thread_id', threadId)
        .is('parent_message_id', null)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      const ordered = (msgs ?? []).slice().reverse()
      const reactionsByMessage = await fetchReactionsFor(ordered.map((m) => m.id))
      const full: Message[] = ordered.map((m) => ({ ...m, reactions: reactionsByMessage.get(m.id) ?? [] }))
      loadedThreads.current.add(threadId)
      setMessagesByThread((prev) => ({ ...prev, [threadId]: full }))
      setHasMoreOlderByThread((prev) => ({ ...prev, [threadId]: (msgs ?? []).length >= PAGE_SIZE }))
      setLoading(false)
      resolveMainImageAttachments(threadId, full)
    },
    [supabase, fetchReactionsFor, resolveMainImageAttachments]
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
        .select(MESSAGE_COLUMNS)
        .eq('thread_id', threadId)
        .is('parent_message_id', null)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      const ordered = (msgs ?? []).slice().reverse()
      const reactionsByMessage = await fetchReactionsFor(ordered.map((m) => m.id))
      const older: Message[] = ordered.map((m) => ({ ...m, reactions: reactionsByMessage.get(m.id) ?? [] }))

      setMessagesByThread((prev) => ({ ...prev, [threadId]: [...older, ...(prev[threadId] ?? [])] }))
      setHasMoreOlderByThread((prev) => ({ ...prev, [threadId]: older.length >= PAGE_SIZE }))
      resolveMainImageAttachments(threadId, older)

      requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - prevScrollHeight
        isLoadingOlderRef.current = false
        setLoadingOlder(false)
      })
    },
    [supabase, fetchReactionsFor, resolveMainImageAttachments, loadingOlder]
  )

  const loadThreadReplies = useCallback(
    async (parentId: string) => {
      setLoadingThread(true)
      const { data: msgs } = await supabase.from('messages').select(MESSAGE_COLUMNS).eq('parent_message_id', parentId).order('created_at', { ascending: true })
      const reactionsByMessage = await fetchReactionsFor((msgs ?? []).map((m) => m.id))
      const full: Message[] = (msgs ?? []).map((m) => ({ ...m, reactions: reactionsByMessage.get(m.id) ?? [] }))
      loadedThreadParents.current.add(parentId)
      setRepliesByParent((prev) => ({ ...prev, [parentId]: full }))
      setLoadingThread(false)
      resolveThreadImageAttachments(parentId, full)
    },
    [supabase, fetchReactionsFor, resolveThreadImageAttachments]
  )

  useEffect(() => {
    if (!activeThreadId) return
    if (!loadedThreads.current.has(activeThreadId)) {
      loadThread(activeThreadId)
    } else {
      setLoading(false)
    }
    markRead(activeThreadId)
    setOpenThreadParentId(null)
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

        if (incoming.parent_message_id) {
          const parentId = incoming.parent_message_id
          setMessagesByThread((prev) =>
            patchMessage(prev, incoming.thread_id, parentId, (m) => ({ ...m, reply_count: m.reply_count + 1, last_reply_at: incoming.created_at }))
          )
          setRepliesByParent((prev) => {
            if (!loadedThreadParents.current.has(parentId)) return prev
            const list = prev[parentId] ?? []
            if (list.some((m) => m.id === incoming.id)) return prev
            return { ...prev, [parentId]: [...list, withReactions] }
          })
          if (incoming.attachment_path && incoming.attachment_type?.startsWith('image/')) {
            resolveThreadImageAttachments(parentId, [withReactions])
          }
        } else {
          setMessagesByThread((prev) => {
            if (!loadedThreads.current.has(incoming.thread_id)) return prev
            const list = prev[incoming.thread_id] ?? []
            if (list.some((m) => m.id === incoming.id)) return prev
            return { ...prev, [incoming.thread_id]: [...list, withReactions] }
          })
          if (incoming.attachment_path && incoming.attachment_type?.startsWith('image/')) {
            resolveMainImageAttachments(incoming.thread_id, [withReactions])
          }
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
          const apply = (m: Message) =>
            m.reactions.some((x) => x.id === r.id) ? m : { ...m, reactions: [...m.reactions, { id: r.id, emoji: r.emoji, user_id: r.user_id }] }
          setMessagesByThread((prev) => patchMessage(prev, r.thread_id, r.message_id, apply))
          setRepliesByParent((prev) => patchReplyMessage(prev, r.message_id, apply))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions', filter: `org_id=eq.${orgId}` },
        (payload) => {
          const old = payload.old as { id: string; thread_id: string; message_id: string }
          const apply = (m: Message) => ({ ...m, reactions: m.reactions.filter((x) => x.id !== old.id) })
          setMessagesByThread((prev) => patchMessage(prev, old.thread_id, old.message_id, apply))
          setRepliesByParent((prev) => patchReplyMessage(prev, old.message_id, apply))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, supabase])

  // dmThreads (contact -> thread id) is computed once server-side from the participant rows
  // that exist at page load - if a teammate DMs you for the very first time while this page is
  // open, get_or_create_dm_thread() creates your participant row, but nothing pushes that
  // mapping to this client, so the new thread's messages/unread dot silently have nowhere to
  // attach in the sidebar until reload. Listen for that participant row landing and backfill it.
  useEffect(() => {
    const channel = supabase
      .channel(`dm-participants-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_thread_participants', filter: `user_id=eq.${userId}` },
        async (payload) => {
          const row = payload.new as { thread_id: string; user_id: string }
          if (row.thread_id === teamThreadId) return
          const { data: other } = await supabase
            .from('message_thread_participants')
            .select('user_id')
            .eq('thread_id', row.thread_id)
            .neq('user_id', userId)
            .maybeSingle()
          if (other) {
            setDmThreads((prev) => (prev[other.user_id] ? prev : { ...prev, [other.user_id]: row.thread_id }))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, teamThreadId, supabase])

  useEffect(() => {
    if (isLoadingOlderRef.current) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messagesByThread, activeThreadId])

  useEffect(() => {
    threadScrollRef.current?.scrollTo({ top: threadScrollRef.current.scrollHeight })
  }, [repliesByParent, openThreadParentId])

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

  function passesSidebarFilter(threadId: string | null | undefined) {
    if (sidebarFilter === 'all') return true
    if (sidebarFilter === 'unread') return unread(threadId)
    return hasUnreadMention(threadId)
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

  const insertMessage = useCallback(
    async ({
      body,
      pendingFile: file,
      mentionCandidates: candidates,
      threadId,
      parentId,
    }: {
      body: string
      pendingFile: File | null
      mentionCandidates: MentionOption[]
      threadId: string
      parentId?: string
    }): Promise<Message | null> => {
      let attachment: Pick<Message, 'attachment_path' | 'attachment_name' | 'attachment_type' | 'attachment_size_bytes'> | null = null
      if (file) {
        const path = `${threadId}/${Date.now()}-${file.name}`
        const { error: uploadError } = await supabase.storage.from('message-attachments').upload(path, file)
        if (uploadError) {
          toast.error('File upload failed')
          return null
        }
        attachment = { attachment_path: path, attachment_name: file.name, attachment_type: file.type || null, attachment_size_bytes: file.size }
      }

      const mentionedUserIds = new Set<string>()
      for (const c of candidates) {
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

      const { data, error } = await supabase
        .from('messages')
        .insert({
          thread_id: threadId,
          org_id: orgId,
          sender_id: userId,
          body,
          mentioned_user_ids: [...mentionedUserIds],
          parent_message_id: parentId ?? null,
          ...(attachment ?? {}),
        })
        .select()
        .single()
      if (error) {
        toast.error('Message failed to send')
        return null
      }
      return { ...(data as Omit<Message, 'reactions'>), reactions: [] }
    },
    [supabase, activeIsTeam, members, userId, activeContactId, orgId]
  )

  async function send() {
    const body = draft.trim()
    if ((!body && !pendingFile) || !activeThreadId || sending) return
    setSending(true)
    const savedDraft = body
    const savedFile = pendingFile
    const savedMentions = mentionCandidates
    setDraft('')
    setPendingFile(null)
    setMentionCandidates([])

    const full = await insertMessage({ body, pendingFile, mentionCandidates, threadId: activeThreadId })
    setSending(false)
    if (!full) {
      setDraft(savedDraft)
      setPendingFile(savedFile)
      setMentionCandidates(savedMentions)
      return
    }
    setMessagesByThread((prev) => {
      const list = prev[activeThreadId] ?? []
      if (list.some((m) => m.id === full.id)) return prev
      return { ...prev, [activeThreadId]: [...list, full] }
    })
    if (full.attachment_path && full.attachment_type?.startsWith('image/')) {
      resolveMainImageAttachments(activeThreadId, [full])
    }
    markRead(activeThreadId)
  }

  async function sendReply(parentId: string) {
    const body = threadDraft.trim()
    if ((!body && !threadPendingFile) || !activeThreadId || threadSending) return
    setThreadSending(true)
    const savedDraft = body
    const savedFile = threadPendingFile
    const savedMentions = threadMentionCandidates
    setThreadDraft('')
    setThreadPendingFile(null)
    setThreadMentionCandidates([])

    const full = await insertMessage({ body, pendingFile: threadPendingFile, mentionCandidates: threadMentionCandidates, threadId: activeThreadId, parentId })
    setThreadSending(false)
    if (!full) {
      setThreadDraft(savedDraft)
      setThreadPendingFile(savedFile)
      setThreadMentionCandidates(savedMentions)
      return
    }
    setRepliesByParent((prev) => {
      const list = prev[parentId] ?? []
      if (list.some((m) => m.id === full.id)) return prev
      return { ...prev, [parentId]: [...list, full] }
    })
    if (full.attachment_path && full.attachment_type?.startsWith('image/')) {
      resolveThreadImageAttachments(parentId, [full])
    }
    markRead(activeThreadId)
  }

  function openThread(m: Message) {
    setOpenThreadParentId(m.id)
    if (!loadedThreadParents.current.has(m.id)) {
      loadThreadReplies(m.id)
    }
  }

  // useCallback'd (stable identity across renders) so MessageRow - memoized below - doesn't
  // re-render every message row just because its parent re-rendered for an unrelated reason.
  const toggleReaction = useCallback(
    async (message: Message, emoji: string) => {
      if (!activeThreadId) return
      const mine = message.reactions.find((r) => r.emoji === emoji && r.user_id === userId)
      if (mine) {
        const apply = (m: Message) => ({ ...m, reactions: m.reactions.filter((r) => r.id !== mine.id) })
        setMessagesByThread((prev) => patchMessage(prev, activeThreadId, message.id, apply))
        setRepliesByParent((prev) => patchReplyMessage(prev, message.id, apply))
        await supabase.from('message_reactions').delete().eq('id', mine.id)
      } else {
        const { data, error } = await supabase
          .from('message_reactions')
          .insert({ message_id: message.id, thread_id: activeThreadId, org_id: orgId, user_id: userId, emoji })
          .select()
          .single()
        if (!error && data) {
          const apply = (m: Message) => (m.reactions.some((r) => r.id === data.id) ? m : { ...m, reactions: [...m.reactions, { id: data.id, emoji: data.emoji, user_id: data.user_id }] })
          setMessagesByThread((prev) => patchMessage(prev, activeThreadId, message.id, apply))
          setRepliesByParent((prev) => patchReplyMessage(prev, message.id, apply))
        } else if (error) {
          toast.error('Could not add reaction')
        }
      }
    },
    [activeThreadId, userId, supabase, orgId]
  )

  const openAttachment = useCallback(
    async (m: Message) => {
      if (!m.attachment_path) return
      const { data, error } = await supabase.storage.from('message-attachments').createSignedUrl(m.attachment_path, 60)
      if (error || !data) {
        toast.error('Could not open file')
        return
      }
      window.open(data.signedUrl, '_blank')
    },
    [supabase]
  )

  function senderLabel(senderId: string) {
    if (senderId === userId) return 'You'
    return memberName(memberMap.get(senderId))
  }

  function senderAvatar(senderId: string) {
    return memberMap.get(senderId)?.avatar_url ?? null
  }

  function insertMention(option: MentionOption, setDraftFn: React.Dispatch<React.SetStateAction<string>>, setCandidatesFn: React.Dispatch<React.SetStateAction<MentionOption[]>>) {
    setDraftFn((prev) => prev.replace(MENTION_TRIGGER, (m) => (m.startsWith(' ') ? ' ' : '') + `@${option.name} `))
    setCandidatesFn((prev) => [...prev, option])
  }

  const messages = (activeThreadId && messagesByThread[activeThreadId]) || []
  const mentionMatch = draft.match(MENTION_TRIGGER)
  const mentionQuery = mentionMatch?.[1] ?? null
  const mentionResults = computeMentionResults(draft, contacts)

  const threadMentionMatch = threadDraft.match(MENTION_TRIGGER)
  const threadMentionQuery = threadMentionMatch?.[1] ?? null
  const threadMentionResults = computeMentionResults(threadDraft, contacts)

  const openThreadParent = openThreadParentId ? messages.find((m) => m.id === openThreadParentId) ?? null : null
  const threadReplies = openThreadParentId ? repliesByParent[openThreadParentId] ?? [] : []

  const visibleContacts = contacts.filter((c) => passesSidebarFilter(dmThreads[c.user_id]))
  const teamVisible = passesSidebarFilter(teamThreadId)

  return (
    <div className="mb-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <p className="text-sm text-sage">Team chat and direct messages</p>
      </div>

      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[420px]">
        <aside className="w-56 shrink-0 rounded-2xl bg-white shadow-md p-2 overflow-y-auto">
          <div className="flex items-center gap-0.5 rounded-lg bg-sand p-0.5 mb-2">
            {(['all', 'unread', 'mentions'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setSidebarFilter(f)}
                className={`relative flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${
                  sidebarFilter === f ? 'text-ink' : 'text-sage hover:text-ink'
                }`}
              >
                {sidebarFilter === f && (
                  <motion.div
                    layoutId="messages-sidebar-filter-active"
                    className="absolute inset-0 rounded-md bg-white"
                    style={{ boxShadow: 'inset 2px 0 0 0 var(--accent), 0 1px 2px 0 rgb(0 0 0 / 0.05)' }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative">{f === 'all' ? 'All' : f === 'unread' ? 'Unread' : '@Mentions'}</span>
              </button>
            ))}
          </div>

          {teamVisible && (
            <button
              onClick={openTeamChannel}
              className={`w-full text-left rounded-lg px-3 py-2 mb-1 text-sm flex items-center gap-2 transition-colors ${
                activeIsTeam ? 'bg-accent text-white font-medium' : 'text-ink hover:bg-sand'
              }`}
            >
              <MessageCircleIcon size={15} />
              <span className="flex-1">Team</span>
              {!activeIsTeam && hasUnreadMention(teamThreadId) && (
                <span className="h-4 w-4 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center shrink-0">@</span>
              )}
              {!activeIsTeam && !hasUnreadMention(teamThreadId) && unread(teamThreadId) && (
                <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
              )}
            </button>
          )}

          <div className="px-3 pt-3 pb-1 text-xs font-medium text-sage tracking-wide">Direct messages</div>
          {contacts.length === 0 && <div className="px-3 py-2 text-xs text-sage">No other teammates yet</div>}
          {contacts.length > 0 && visibleContacts.length === 0 && !teamVisible && (
            <div className="px-3 py-2 text-xs text-sage">{sidebarFilter === 'unread' ? 'No unread conversations' : 'No unread mentions'}</div>
          )}
          {visibleContacts.map((c) => {
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

        <section className="flex-1 min-w-0 rounded-2xl bg-white shadow-md flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-0.5">
            {loading && <div className="text-sm text-sage px-2">Loading…</div>}
            {!loading && messages.length === 0 && <div className="text-sm text-sage px-2">No messages yet. Say hi!</div>}
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
              const showDateSeparator = showDateSeparatorAt(messages, i)
              return (
                <MessageRow
                  key={m.id}
                  m={m}
                  grouped={groupedAt(messages, i, showDateSeparator)}
                  avatarUrl={senderAvatar(m.sender_id)}
                  senderName={senderLabel(m.sender_id)}
                  showDateSeparator={showDateSeparator}
                  userId={userId}
                  memberMap={memberMap}
                  showThreadIndicator
                  allowThreadReply
                  onToggleReaction={toggleReaction}
                  onOpenAttachment={openAttachment}
                  onOpenThread={openThread}
                />
              )
            })}
          </div>

          <MessageComposer
            draft={draft}
            setDraft={setDraft}
            pendingFile={pendingFile}
            setPendingFile={setPendingFile}
            sending={sending}
            onSubmit={send}
            mentionQuery={mentionQuery}
            mentionResults={mentionResults}
            onInsertMention={(c) => insertMention(c, setDraft, setMentionCandidates)}
            placeholder={activeIsTeam ? 'Message the team… (@ to mention)' : 'Type a message…'}
            disabled={!activeThreadId}
          />
        </section>

        {openThreadParentId && (
          <section className="w-[380px] shrink-0 rounded-2xl bg-white shadow-md flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-3 border-b border-ink/10">
              <span className="text-sm font-semibold text-ink">Thread</span>
              <button onClick={() => setOpenThreadParentId(null)} className="text-sage hover:text-ink p-1">
                <XIcon size={16} />
              </button>
            </div>

            <div ref={threadScrollRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-0.5">
              {loadingThread && <div className="text-sm text-sage px-2">Loading…</div>}
              {!loadingThread && openThreadParent && (
                <>
                  <MessageRow
                    m={openThreadParent}
                    grouped={false}
                    avatarUrl={senderAvatar(openThreadParent.sender_id)}
                    senderName={senderLabel(openThreadParent.sender_id)}
                    showDateSeparator={false}
                    userId={userId}
                    memberMap={memberMap}
                    showThreadIndicator={false}
                    allowThreadReply={false}
                    onToggleReaction={toggleReaction}
                    onOpenAttachment={openAttachment}
                    onOpenThread={() => {}}
                  />
                  <div className="flex items-center gap-2 my-2 px-2">
                    <span className="text-xs font-medium text-sage">
                      {threadReplies.length} {threadReplies.length === 1 ? 'reply' : 'replies'}
                    </span>
                    <span className="flex-1 h-px bg-ink/10" />
                  </div>
                  {threadReplies.map((m, i) => {
                    const showDateSeparator = showDateSeparatorAt(threadReplies, i)
                    return (
                      <MessageRow
                        key={m.id}
                        m={m}
                        grouped={groupedAt(threadReplies, i, showDateSeparator)}
                        avatarUrl={senderAvatar(m.sender_id)}
                        senderName={senderLabel(m.sender_id)}
                        showDateSeparator={showDateSeparator}
                        userId={userId}
                        memberMap={memberMap}
                        showThreadIndicator={false}
                        allowThreadReply={false}
                        onToggleReaction={toggleReaction}
                        onOpenAttachment={openAttachment}
                        onOpenThread={() => {}}
                      />
                    )
                  })}
                </>
              )}
            </div>

            <MessageComposer
              draft={threadDraft}
              setDraft={setThreadDraft}
              pendingFile={threadPendingFile}
              setPendingFile={setThreadPendingFile}
              sending={threadSending}
              onSubmit={() => openThreadParentId && sendReply(openThreadParentId)}
              mentionQuery={threadMentionQuery}
              mentionResults={threadMentionResults}
              onInsertMention={(c) => insertMention(c, setThreadDraft, setThreadMentionCandidates)}
              placeholder="Reply…"
              disabled={!activeThreadId}
            />
          </section>
        )}
      </div>
    </div>
  )
}
