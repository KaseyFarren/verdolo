'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { toast } from 'sonner'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'
import { XIcon } from '@/components/ui/icons'

type SavedNote = { id: string; client_id: string; text: string; created_at: string; author_id: string | null }

export default function ClientUpdateModal({
  supabase,
  orgId,
  userId,
  clientId,
  onSaved,
  onClose,
}: {
  supabase: SupabaseClient
  orgId: string
  userId: string
  clientId: string
  onSaved: (note: SavedNote) => void
  onClose: () => void
}) {
  const [generating, setGenerating] = useState(true)
  const [saving, setSaving] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function generate() {
      try {
        const res = await fetch('/api/ai/client-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, clientId }),
        })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(json.error || 'Generation failed')
        } else {
          setText(json.text || '')
        }
      } catch {
        if (!cancelled) setError('Could not reach the server')
      } finally {
        if (!cancelled) setGenerating(false)
      }
    }
    generate()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy - select the text manually')
    }
  }

  async function saveToActivity() {
    if (!text.trim()) return
    setSaving(true)
    const id = crypto.randomUUID()
    const [{ error: noteError, data: noteData }] = await Promise.all([
      supabase
        .from('client_notes')
        .insert({ id, org_id: orgId, client_id: clientId, author_id: userId, text: text.trim() })
        .select()
        .single(),
      supabase.from('ai_message_log').insert({ org_id: orgId, client_id: clientId, message: text.trim() }),
    ])
    setSaving(false)
    if (noteError || !noteData) {
      toast.error('Could not save that update')
      return
    }
    toast.success('Saved to activity')
    onSaved(noteData as SavedNote)
    onClose()
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-5 pt-[8vh] overflow-y-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-lg rounded-lg border border-ink/10 bg-white p-4 shadow-xl mb-[8vh]"
          initial={{ opacity: 0, scale: 0.96, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -8 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold tracking-wide text-sage">Draft client update</div>
            <button onClick={onClose} className="text-sage hover:text-ink">
              <XIcon size={16} />
            </button>
          </div>

          {generating && <div className="text-sm text-sage py-6 text-center">Drafting…</div>}

          {!generating && error && (
            <>
              <div className="text-sm text-sage mb-3">{error}</div>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </>
          )}

          {!generating && !error && (
            <>
              <div className="text-sm text-sage mb-2">Covers the last two weeks - edit before sending.</div>
              <textarea
                className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm mb-3 min-h-[160px]"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="secondary" onClick={copy} disabled={!text.trim()}>
                  Copy
                </Button>
                <Button variant="primary" className="flex-1" onClick={saveToActivity} disabled={saving || !text.trim()}>
                  {saving ? 'Saving…' : 'Save to activity'}
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
