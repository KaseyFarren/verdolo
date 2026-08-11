'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'
import { FileIcon, PaperclipIcon, PdfFileIcon, SheetFileIcon, XIcon } from '@/components/ui/icons'

type Message = {
  id: string
  sender_id: string
  body: string
  created_at: string
  deleted_at: string | null
  attachment_path: string | null
  attachment_name: string | null
  attachment_type: string | null
  attachment_size_bytes: number | null
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

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

function FileTypeIcon({ fileName, size }: { fileName: string; size: number }) {
  const ext = extOf(fileName)
  if (ext === 'pdf') return <PdfFileIcon size={size} />
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return <SheetFileIcon size={size} />
  return <FileIcon size={size} />
}

// Minimal two-party chat: no per-sender identity beyond "is this me" vs otherPartyLabel (a
// client user has no RLS-visible path to org member profiles, so the team side can only ever
// be labeled generically here) - reactions/mentions/edit live in the full team MessagesClient
// only. Attachments reuse the same 'message-attachments' bucket and can_access_thread() policy.
export default function ThreadChat({
  supabase,
  orgId,
  threadId,
  userId,
  otherPartyLabel,
  notifyClientId,
}: {
  supabase: SupabaseClient
  orgId: string
  threadId: string
  userId: string
  otherPartyLabel?: string
  // Set only from the portal side (a client sending) - fires a best-effort email to the team
  // after a successful send. Team-side callers (ClientChat) omit this; a teammate replying
  // shouldn't trigger a "client messaged you" alert to themselves/other teammates.
  notifyClientId?: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [body, setBody] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase
      .from('messages')
      .select('id, sender_id, body, created_at, deleted_at, attachment_path, attachment_name, attachment_type, attachment_size_bytes')
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

  useEffect(() => {
    const imagePaths = messages
      .filter((m) => m.attachment_path && m.attachment_type?.startsWith('image/') && !imageUrls[m.attachment_path])
      .map((m) => m.attachment_path!)
    if (imagePaths.length === 0) return
    supabase.storage
      .from('message-attachments')
      .createSignedUrls(imagePaths, 3600)
      .then(({ data }) => {
        if (!data) return
        setImageUrls((prev) => {
          const next = { ...prev }
          for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl
          return next
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, supabase])

  async function openAttachment(m: Message) {
    if (!m.attachment_path) return
    const { data, error } = await supabase.storage.from('message-attachments').createSignedUrl(m.attachment_path, 60)
    if (error || !data) {
      toast.error('Could not open file')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  async function send() {
    const trimmed = body.trim()
    if (!trimmed && !pendingFile) return
    setSending(true)
    const file = pendingFile
    setBody('')
    setPendingFile(null)

    let attachment: Pick<Message, 'attachment_path' | 'attachment_name' | 'attachment_type' | 'attachment_size_bytes'> | null = null
    if (file) {
      const path = `${threadId}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage.from('message-attachments').upload(path, file)
      if (uploadError) {
        toast.error('File upload failed')
        setSending(false)
        setBody(trimmed)
        setPendingFile(file)
        return
      }
      attachment = { attachment_path: path, attachment_name: file.name, attachment_type: file.type || null, attachment_size_bytes: file.size }
    }

    const { error } = await supabase.from('messages').insert({ thread_id: threadId, org_id: orgId, sender_id: userId, body: trimmed, ...(attachment ?? {}) })
    setSending(false)
    if (error) {
      setBody(trimmed)
      setPendingFile(file)
      return
    }
    if (notifyClientId) {
      fetch('/api/notify/client-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: notifyClientId }),
      }).catch(() => {})
    }
  }

  return (
    <div className="flex flex-col h-[28rem] rounded-2xl border border-ink/8 bg-white overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {messages.length === 0 && <p className="text-sm text-sage text-center my-auto">No messages yet - say hello.</p>}
        {messages
          .filter((m) => !m.deleted_at)
          .map((m) => {
            const mine = m.sender_id === userId
            const isImage = m.attachment_path && m.attachment_type?.startsWith('image/')
            return (
              <div key={m.id} className={`flex flex-col max-w-[75%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
                {!mine && otherPartyLabel && <span className="text-xs text-sage mb-0.5 px-1">{otherPartyLabel}</span>}
                {m.attachment_path && (
                  <div className={`mb-1 ${mine ? 'self-end' : 'self-start'}`}>
                    {isImage && imageUrls[m.attachment_path] ? (
                      <img
                        src={imageUrls[m.attachment_path]}
                        alt={m.attachment_name ?? ''}
                        className="max-w-[220px] max-h-[220px] rounded-xl border border-ink/10 cursor-pointer object-cover"
                        onClick={() => openAttachment(m)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => openAttachment(m)}
                        className="flex items-center gap-2 rounded-xl border border-ink/10 bg-sand px-3 py-2 text-sm hover:bg-ink/5"
                      >
                        <FileTypeIcon fileName={m.attachment_name ?? ''} size={15} />
                        <span className="truncate max-w-[160px]">{m.attachment_name}</span>
                        <span className="text-xs text-sage shrink-0">{formatFileSize(m.attachment_size_bytes)}</span>
                      </button>
                    )}
                  </div>
                )}
                {m.body && (
                  <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${mine ? 'bg-accent text-white' : 'bg-sand text-ink'}`}>{m.body}</div>
                )}
              </div>
            )
          })}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-ink/8 p-3">
        {pendingFile && (
          <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-sand px-2.5 py-1.5 mb-2 text-xs">
            <FileTypeIcon fileName={pendingFile.name} size={14} />
            <span className="truncate flex-1">{pendingFile.name}</span>
            <span className="text-sage">{formatFileSize(pendingFile.size)}</span>
            <button type="button" onClick={() => setPendingFile(null)} className="text-sage hover:text-ink">
              <XIcon size={12} />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="text-sage hover:text-ink p-1.5" title="Attach a file">
            <PaperclipIcon size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                if (file.size > MAX_ATTACHMENT_BYTES) toast.error(`That file is too large - attachments are limited to ${formatFileSize(MAX_ATTACHMENT_BYTES)}`)
                else setPendingFile(file)
              }
              e.target.value = ''
            }}
          />
          <input
            className="flex-1 rounded-full border border-ink/10 bg-white px-4 py-2 text-sm"
            placeholder="Message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          />
          <Button variant="primary" size="sm" disabled={sending || (!body.trim() && !pendingFile)} onClick={send}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
