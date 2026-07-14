'use client'

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { toast } from 'sonner'
import type { SupabaseClient } from '@supabase/supabase-js'
import CustomSelect from '@/components/ui/CustomSelect'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { UploadCloudIcon, XIcon, TrashIcon } from '@/components/ui/icons'
import { PRIORITY, todayKey } from '@/lib/agency'

type Client = { id: string; name: string }
type Task = {
  id: string
  client_id: string | null
  assigned_to: string | null
  assignee_ids: string[]
  parent_task_id: string | null
  title: string
  due_date: string
  priority: string
  notes: string | null
  done: boolean
  completed_at: string | null
  is_auto: boolean
  auto_type: string | null
  recurring_id: string | null
  default_template_id: string | null
  quick: boolean
  skipped: boolean
}
type Draft = { title: string; due_date: string | null; priority: string; notes: string; include: boolean }

const ACCEPTED_EXT = ['.txt', '.md', '.pdf']
const MAX_PDF_BYTES = 3 * 1024 * 1024

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function ImportTasksModal({
  supabase,
  orgId,
  clients,
  onImported,
  onClose,
}: {
  supabase: SupabaseClient
  orgId: string
  clients: Client[]
  onImported: (tasks: Task[]) => void
  onClose: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [clientId, setClientId] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drafts, setDrafts] = useState<Draft[] | null>(null)

  function pickFile(f: File | null) {
    if (!f) return
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
    if (!ACCEPTED_EXT.includes(ext)) {
      toast.error('Upload a .txt, .md, or .pdf file, or paste text instead')
      return
    }
    if (ext === '.pdf' && f.size > MAX_PDF_BYTES) {
      toast.error('That PDF is too large (3MB max) - try pasting the text instead')
      return
    }
    setFile(f)
    setPastedText('')
  }

  async function generate() {
    if (!file && !pastedText.trim()) {
      toast.error('Paste some text or upload a file first')
      return
    }
    setGenerating(true)
    try {
      const body: Record<string, unknown> = { orgId, clientId: clientId || null }
      if (file && file.name.toLowerCase().endsWith('.pdf')) {
        body.pdfBase64 = await readAsBase64(file)
      } else if (file) {
        body.text = await readAsText(file)
      } else {
        body.text = pastedText
      }

      const res = await fetch('/api/ai/tasks-from-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Generation failed')
        return
      }
      const tasks = (json.tasks || []) as { title: string; due_date: string | null; priority: string; notes: string }[]
      if (!tasks.length) {
        toast.error('No actionable tasks found in that document')
        return
      }
      setDrafts(tasks.map((t) => ({ ...t, include: true })))
    } catch {
      toast.error('Could not read that file')
    } finally {
      setGenerating(false)
    }
  }

  function updateDraft(i: number, fields: Partial<Draft>) {
    setDrafts((prev) => (prev ? prev.map((d, idx) => (idx === i ? { ...d, ...fields } : d)) : prev))
  }

  function removeDraft(i: number) {
    setDrafts((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev))
  }

  async function addTasks() {
    const toInsert = (drafts || []).filter((d) => d.include && d.title.trim())
    if (!toInsert.length) return
    setSaving(true)
    const { data, error } = await supabase
      .from('tasks')
      .insert(
        toInsert.map((d) => ({
          org_id: orgId,
          client_id: clientId || null,
          title: d.title.trim(),
          due_date: d.due_date || todayKey(),
          priority: d.priority,
          notes: d.notes || '',
          done: false,
        }))
      )
      .select()
    setSaving(false)
    if (error || !data) {
      toast.error('Could not add tasks')
      return
    }
    toast.success(`${data.length} task${data.length === 1 ? '' : 's'} added`)
    onImported(data as Task[])
    onClose()
  }

  const includedCount = (drafts || []).filter((d) => d.include).length

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[8vh] overflow-y-auto"
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
            <div className="text-xs font-semibold uppercase tracking-wide text-sage">Import tasks from doc</div>
            <button onClick={onClose} className="text-sage hover:text-ink">
              <XIcon size={16} />
            </button>
          </div>

          {!drafts && (
            <>
              <div className="text-xs text-sage mb-1">Client (optional)</div>
              <CustomSelect
                value={clientId}
                onChange={setClientId}
                options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                className="mb-3"
              />

              {file ? (
                <div className="flex items-center justify-between rounded border border-ink/10 bg-sand px-3 py-2 text-sm mb-3">
                  <span className="truncate">{file.name}</span>
                  <button onClick={() => setFile(null)} className="text-sage hover:text-ink shrink-0 ml-2">
                    <TrashIcon size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <textarea
                    className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm mb-2 min-h-[140px]"
                    placeholder="Paste a meeting transcript or notes here…"
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 rounded border border-dashed border-ink/20 px-3 py-2 text-xs text-sage hover:text-ink hover:border-ink/40 mb-3"
                  >
                    <UploadCloudIcon size={14} />
                    or upload a .txt, .md, or .pdf file
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.pdf"
                    className="hidden"
                    onChange={(e) => pickFile(e.target.files?.[0] || null)}
                  />
                </>
              )}

              <div className="flex gap-2">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" className="flex-1" onClick={generate} disabled={generating}>
                  {generating ? 'Reading document…' : 'Generate tasks'}
                </Button>
              </div>
            </>
          )}

          {drafts && (
            <>
              <div className="text-sm text-sage mb-3">Found {drafts.length} task{drafts.length === 1 ? '' : 's'} - review before adding.</div>
              <div className="space-y-4 mb-3 max-h-[50vh] overflow-y-auto pr-1">
                {drafts.map((d, i) => (
                  <div key={i} className="rounded-lg border border-ink/10 p-3">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => updateDraft(i, { include: !d.include })}
                        className={`mt-1.5 h-4 w-4 rounded-[4px] border flex items-center justify-center shrink-0 ${d.include ? 'bg-green border-green' : 'border-ink/25'}`}
                      >
                        {d.include && <span className="text-[10px] text-white">✓</span>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <input
                          className="w-full rounded-[6px] border border-ink/10 bg-white px-2 py-1.5 text-sm mb-2"
                          value={d.title}
                          onChange={(e) => updateDraft(i, { title: e.target.value })}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <DatePicker
                            value={d.due_date || ''}
                            onChange={(v) => updateDraft(i, { due_date: v || null })}
                            placeholder="Due date"
                            className="text-xs"
                          />
                          <CustomSelect
                            value={d.priority}
                            onChange={(v) => updateDraft(i, { priority: v })}
                            options={PRIORITY.map((p) => ({ value: p, label: p }))}
                          />
                        </div>
                        {d.notes && <div className="text-xs text-sage mt-2">{d.notes}</div>}
                      </div>
                      <button onClick={() => removeDraft(i)} className="text-sage hover:text-ink shrink-0">
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setDrafts(null)}>
                  Back
                </Button>
                <Button variant="primary" className="flex-1" onClick={addTasks} disabled={saving || includedCount === 0}>
                  {saving ? 'Adding…' : `Add ${includedCount} task${includedCount === 1 ? '' : 's'}`}
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
