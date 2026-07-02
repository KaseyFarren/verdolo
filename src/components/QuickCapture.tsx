'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { todayKey } from '@/lib/agency'
import Button from '@/components/ui/Button'

export default function QuickCapture({ orgId, userId }: { orgId: string; userId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function submit() {
    const trimmed = title.trim()
    if (!trimmed) return
    setSubmitting(true)
    const supabase = createClient()
    const { error } = await supabase.from('tasks').insert({
      org_id: orgId,
      title: trimmed,
      due_date: todayKey(),
      quick: true,
      done: false,
      assigned_to: userId,
    })
    setSubmitting(false)
    if (error) {
      toast.error('Could not add task')
      return
    }
    toast.success('Task added')
    setTitle('')
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.92 }}
        whileHover={{ scale: 1.05 }}
        onClick={() => setOpen(true)}
        title="Quick add (⌘K)"
        className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full bg-accent text-white text-2xl leading-none shadow-lg flex items-center justify-center"
      >
        +
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[15vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="w-full max-w-md rounded-lg border border-white/10 bg-neutral-900 p-4 shadow-xl"
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Quick add task</div>
              <input
                autoFocus
                className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="What needs doing?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={submit} disabled={submitting || !title.trim()}>
                  {submitting ? 'Adding…' : 'Add task'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
