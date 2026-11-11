'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'
import { notifyOther } from '@/lib/notifyClient'

type Comment = { id: string; author_id: string; author_name: string | null; body: string; created_at: string }

function when(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Comment thread on one task. Used on both sides: the team's task details and the client
 * portal. Who can read/post is decided by RLS (task_comments follows the task's visibility), and
 * the other side is emailed via /api/notify. */
export default function TaskComments({
  supabase,
  taskId,
  orgId,
  userId,
  placeholder = 'Add a comment…',
}: {
  supabase: SupabaseClient
  taskId: string
  orgId: string
  userId: string
  placeholder?: string
}) {
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('task_comments').select('id, author_id, author_name, body, created_at').eq('task_id', taskId).order('created_at')
    setComments((data as Comment[]) ?? [])
  }, [supabase, taskId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function post() {
    const text = body.trim()
    if (!text || saving) return
    setSaving(true)
    const { data, error } = await supabase.from('task_comments').insert({ task_id: taskId, org_id: orgId, author_id: userId, body: text }).select('id, author_id, author_name, body, created_at').single()
    setSaving(false)
    if (error) {
      toast.error('Could not post the comment')
      return
    }
    setBody('')
    setComments((prev) => [...(prev ?? []), data as Comment])
    notifyOther('comment', (data as Comment).id)
  }

  async function remove(id: string) {
    const { error } = await supabase.from('task_comments').delete().eq('id', id)
    if (error) return toast.error('Could not delete the comment')
    setComments((prev) => (prev ?? []).filter((c) => c.id !== id))
  }

  return (
    <div>
      <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1.5">Comments</div>
      {comments === null ? (
        <p className="text-xs text-sage mb-2">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-sage mb-2">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-sand/60 px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] text-sage mb-0.5">
                <span className="font-semibold text-ink/80">{c.author_id === userId ? 'You' : c.author_name || 'Someone'}</span>
                <span>{when(c.created_at)}</span>
                {c.author_id === userId && (
                  <button type="button" onClick={() => remove(c.id)} className="ml-auto hover:text-ink">
                    Delete
                  </button>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <textarea
          className="w-full rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm min-h-[64px]"
          placeholder={placeholder}
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post()
          }}
        />
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" disabled={!body.trim() || saving} onClick={post}>
            {saving ? 'Posting…' : 'Post comment'}
          </Button>
        </div>
      </div>
    </div>
  )
}
