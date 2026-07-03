'use client'

import CustomSelect from '@/components/ui/CustomSelect'
import { PRIORITY, memberName } from '@/lib/agency'

type Client = { id: string; name: string }
type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null }

export default function TaskEditForm({
  editForm,
  setEditForm,
  clients,
  members,
  showDueDate = true,
  onCancel,
  onSave,
}: {
  editForm: Record<string, unknown>
  setEditForm: (f: (prev: Record<string, unknown>) => Record<string, unknown>) => void
  clients: Client[]
  members: Member[]
  showDueDate?: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4 mb-2">
      <input
        className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-2 font-medium"
        value={(editForm.title as string) || ''}
        onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2 mb-2">
        <CustomSelect
          value={(editForm.client_id as string) || ''}
          onChange={(v) => setEditForm((f) => ({ ...f, client_id: v }))}
          options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <CustomSelect
          value={(editForm.priority as string) || 'Medium'}
          onChange={(v) => setEditForm((f) => ({ ...f, priority: v }))}
          options={PRIORITY.map((p) => ({ value: p, label: p }))}
        />
        <CustomSelect
          value={(editForm.assigned_to as string) || ''}
          onChange={(v) => setEditForm((f) => ({ ...f, assigned_to: v }))}
          options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.user_id, label: memberName(m) }))]}
        />
        {showDueDate && (
          <input
            type="date"
            className="rounded border border-ink/10 bg-white px-2 py-2 text-sm"
            value={(editForm.due_date as string) || ''}
            onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
          />
        )}
      </div>
      <textarea
        className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-3"
        value={(editForm.notes as string) || ''}
        onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
      />
      <div className="flex gap-2">
        <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="flex-1 rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  )
}
