'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import CustomSelect from '@/components/ui/CustomSelect'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { TrashIcon, XIcon } from '@/components/ui/icons'
import { todayKey } from '@/lib/agency'

export type ProjectFormValues = {
  name: string
  description: string
  client_id: string | null
  budget_id: string | null
  status: string
  start_date: string | null
  due_date: string | null
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
]

// Titles-only editor for the phases a new project starts with - mirrors the SubtaskListEditor
// pattern used for default/recurring task templates (TasksClient.tsx). Only shown on create;
// once a project exists, phases are added/renamed/reordered from the project page itself.
function PhaseListEditor({ names, onChange }: { names: string[]; onChange: (names: string[]) => void }) {
  const [draft, setDraft] = useState('')
  function commit() {
    if (!draft.trim()) return
    onChange([...names, draft.trim()])
    setDraft('')
  }
  return (
    <div className="mb-3">
      <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Starting phases</div>
      {names.map((name, i) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <span className="flex-1 text-sm truncate">{name}</span>
          <button type="button" className="text-sage hover:text-red-600 shrink-0" onClick={() => onChange(names.filter((_, idx) => idx !== i))}>
            <TrashIcon size={13} />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-[8px] border border-ink/10 bg-white px-3 py-1.5 text-sm"
          placeholder="Add a phase (e.g. Discovery)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={commit}>
          Add
        </Button>
      </div>
    </div>
  )
}

export default function ProjectFormModal({
  initial,
  clients,
  budgets,
  onSave,
  onClose,
}: {
  initial?: { id: string; name: string; description: string | null; client_id: string | null; budget_id: string | null; status: string; start_date: string | null; due_date: string | null } | null
  clients: { id: string; name: string }[]
  budgets: { id: string; client_id: string; name: string }[]
  onSave: (values: ProjectFormValues, phaseNames: string[]) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [clientId, setClientId] = useState(initial?.client_id || '')
  const [budgetId, setBudgetId] = useState(initial?.budget_id || '')
  const [status, setStatus] = useState(initial?.status || 'active')
  const [startDate, setStartDate] = useState(initial?.start_date || todayKey())
  const [dueDate, setDueDate] = useState(initial?.due_date || '')
  const [phaseNames, setPhaseNames] = useState<string[]>(['Phase 1'])

  const clientBudgets = budgets.filter((b) => b.client_id === clientId)

  function save() {
    if (!name.trim()) return
    onSave(
      {
        name: name.trim(),
        description: description.trim(),
        client_id: clientId || null,
        budget_id: budgetId || null,
        status,
        start_date: startDate || null,
        due_date: dueDate || null,
      },
      phaseNames,
    )
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
            <div className="text-xs font-semibold tracking-wide text-sage">{initial ? 'Edit project' : 'New project'}</div>
            <button onClick={onClose} className="text-sage hover:text-ink">
              <XIcon size={16} />
            </button>
          </div>

          <input
            className="w-full rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm mb-3 font-medium"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          <textarea
            className="w-full rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm mb-3 min-h-[60px]"
            placeholder="What is this project (optional)?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Client</div>
              <CustomSelect
                value={clientId}
                onChange={(v) => {
                  setClientId(v)
                  setBudgetId('')
                }}
                options={[{ value: '', label: 'Internal / no client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Status</div>
              <CustomSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            </div>
            {clientBudgets.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Budget</div>
                <CustomSelect value={budgetId} onChange={setBudgetId} options={[{ value: '', label: 'No budget' }, ...clientBudgets.map((b) => ({ value: b.id, label: b.name }))]} />
              </div>
            )}
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Start date</div>
              <DatePicker value={startDate || ''} onChange={setStartDate} placeholder="No start date" />
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Due date</div>
              <DatePicker value={dueDate} onChange={setDueDate} placeholder="No due date" />
            </div>
          </div>

          {!initial && <PhaseListEditor names={phaseNames} onChange={setPhaseNames} />}

          <div className="flex gap-2 mt-1">
            <div className="flex-1" />
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              {initial ? 'Save' : 'Create project'}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
