'use client'

import CustomSelect from '@/components/ui/CustomSelect'
import DatePicker from '@/components/ui/DatePicker'
import { PRIORITY, memberName } from '@/lib/agency'

export type TaskFormState = {
  title: string
  clientId: string
  assignedTo: string
  dueDate: string
  priority: string
  notes: string
}

type Client = { id: string; name: string }
type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null }

export default function AddTaskForm({
  mode,
  setMode,
  form,
  setForm,
  clients,
  members,
  onSubmit,
  onCancel,
  submitLabel = 'Add task',
}: {
  mode: 'quick' | 'detailed'
  setMode: (m: 'quick' | 'detailed') => void
  form: TaskFormState
  setForm: (updater: (f: TaskFormState) => TaskFormState) => void
  clients: Client[]
  members: Member[]
  onSubmit: () => void
  onCancel: () => void
  submitLabel?: string
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4 mb-4">
      <div className="flex gap-1 bg-white rounded-md p-1 mb-3 w-fit">
        {(['quick', 'detailed'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1 rounded text-xs capitalize ${mode === m ? 'bg-ink/5' : 'text-sage'}`}
          >
            {m}
          </button>
        ))}
      </div>
      <input
        className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2"
        placeholder="What needs doing?"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && mode === 'quick') onSubmit()
        }}
        autoFocus
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <DatePicker value={form.dueDate} onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))} placeholder="Due date" allowClear={false} />
        {mode === 'detailed' && (
          <CustomSelect
            value={form.priority}
            onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
            options={PRIORITY.map((p) => ({ value: p, label: p }))}
          />
        )}
        {mode === 'detailed' && (
          <CustomSelect
            value={form.clientId}
            onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
            options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
          />
        )}
        {mode === 'detailed' && (
          <CustomSelect
            value={form.assignedTo}
            onChange={(v) => setForm((f) => ({ ...f, assignedTo: v }))}
            options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.user_id, label: memberName(m) }))]}
          />
        )}
      </div>
      <textarea
        className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-3 min-h-[50px]"
        placeholder="Notes (optional)"
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
      />
      <div className="flex gap-2">
        <button type="button" className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={onSubmit}>
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
