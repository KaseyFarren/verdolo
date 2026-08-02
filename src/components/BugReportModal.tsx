'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import { AlertTriangleIcon } from '@/components/ui/icons'

export default function BugReportModal() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    const trimmed = description.trim()
    if (!trimmed) return
    setSubmitting(true)
    const res = await fetch('/api/bug-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: trimmed, pageUrl: pathname }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      toast.error(error || 'Could not send your report')
      return
    }
    toast.success("Thanks - we'll take a look")
    setDescription('')
    setOpen(false)
  }

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.96 }}
        whileHover={{ scale: 1.02 }}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-cream/20 px-3 py-1.5 text-xs text-cream/80 hover:text-white hover:border-cream/40 transition-colors"
      >
        <AlertTriangleIcon size={13} /> Report a problem
      </motion.button>
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-5 pt-[15vh]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setOpen(false)}
              >
                <motion.div
                  className="w-full max-w-md rounded-lg border border-ink/10 bg-white p-4 shadow-xl text-ink"
                  initial={{ opacity: 0, scale: 0.96, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -8 }}
                  transition={{ duration: 0.15 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="text-xs font-semibold tracking-wide text-sage mb-2">Report a problem</div>
                  <textarea
                    autoFocus
                    className="w-full rounded-md border border-ink/10 bg-white px-3 py-2.5 text-base text-ink placeholder:text-sage/60 mb-3 min-h-[120px] focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                    placeholder="What went wrong? Include what you were trying to do."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={submit} disabled={submitting || !description.trim()}>
                      {submitting ? 'Sending…' : 'Send report'}
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  )
}
