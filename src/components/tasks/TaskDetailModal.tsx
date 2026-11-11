'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import CustomSelect from '@/components/ui/CustomSelect'
import MultiSelect from '@/components/ui/MultiSelect'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { XIcon } from '@/components/ui/icons'
import { PRIORITY, memberName } from '@/lib/agency'
import type { SupabaseClient } from '@supabase/supabase-js'
import TaskComments from '@/components/tasks/TaskComments'
import Switch from '@/components/ui/Switch'
import type { Budget, Client, Member, Phase, Project, Task } from '@/app/(app)/tasks/TasksClient'

// Full view/edit surface for a single task, opened by clicking the task name in the list. Every
// field is editable here at once (the list row also allows quick per-cell inline edits, this is
// the "see and change everything" view). `effectiveAssignees` is passed in so it stays the single
// source of truth for the old-row-with-only-assigned_to fallback.
export default function TaskDetailModal({
  task,
  clients,
  members,
  budgets,
  projects = [],
  phases = [],
  isAdmin,
  effectiveAssignees,
  onSave,
  onDelete,
  onClose,
  comments,
}: {
  task: Task
  clients: Client[]
  members: Member[]
  budgets: Budget[]
  /** Optional - the Tasks page passes org-wide projects/phases; a project-scoped surface can omit these. */
  projects?: Project[]
  phases?: Phase[]
  isAdmin: boolean
  effectiveAssignees: (t: Task) => string[]
  onSave: (fields: {
    title: string
    client_id: string | null
    budget_id: string | null
    project_id: string | null
    phase_id: string | null
    assignee_ids: string[]
    due_date: string
    priority: string
    notes: string
    estimated_hours: number | null
    client_visible: boolean
    for_client: boolean
  }) => void
  onDelete: () => void
  onClose: () => void
  /** Enables the comment thread (shared with the client when the task is in their portal). */
  comments?: { supabase: SupabaseClient; orgId: string; userId: string }
}) {
  const [title, setTitle] = useState(task.title)
  const [clientId, setClientId] = useState(task.client_id || '')
  const [budgetId, setBudgetId] = useState(task.budget_id || '')
  const [projectId, setProjectId] = useState(task.project_id || '')
  const [phaseId, setPhaseId] = useState(task.phase_id || '')
  const [assigneeIds, setAssigneeIds] = useState<string[]>(effectiveAssignees(task))
  const [dueDate, setDueDate] = useState(task.due_date)
  const [priority, setPriority] = useState(task.priority)
  const [notes, setNotes] = useState(task.notes || '')
  const [estimatedHours, setEstimatedHours] = useState(task.estimated_hours != null ? String(task.estimated_hours) : '')
  const [clientVisible, setClientVisible] = useState(!!task.client_visible)
  const [forClient, setForClient] = useState(!!task.for_client)
  const projectClientId = projects.find((p) => p.id === projectId)?.client_id ?? null
  // Project tasks of the client's own project are always in their portal; anything else needs the switch.
  const inPortalViaProject = !!clientId && !!projectId && projectClientId === clientId

  const clientBudgets = budgets.filter((b) => b.client_id === clientId)
  const projectPhases = phases.filter((p) => p.project_id === projectId)

  function save() {
    if (!title.trim()) return
    onSave({
      title: title.trim(),
      client_id: clientId || null,
      budget_id: budgetId || null,
      project_id: projectId || null,
      phase_id: projectId ? phaseId || null : null,
      assignee_ids: assigneeIds,
      due_date: dueDate,
      priority,
      notes,
      estimated_hours: estimatedHours ? Number(estimatedHours) : null,
      client_visible: clientId ? clientVisible : false,
      for_client: clientId ? forClient : false,
    })
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
            <div className="text-xs font-semibold tracking-wide text-sage">Task details</div>
            <button onClick={onClose} className="text-sage hover:text-ink">
              <XIcon size={16} />
            </button>
          </div>

          <input
            className="w-full rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm mb-3 font-medium"
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Client</div>
              <CustomSelect
                value={clientId}
                onChange={(v) => {
                  // Giving a task its first client puts it in that client's portal by default.
                  if (v && !clientId) setClientVisible(true)
                  setClientId(v)
                  setBudgetId('')
                }}
                options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Assigned to</div>
              <MultiSelect value={assigneeIds} onChange={setAssigneeIds} options={members.map((m) => ({ value: m.user_id, label: memberName(m) }))} />
            </div>
            {projects.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Project</div>
                <CustomSelect
                  value={projectId}
                  onChange={(v) => {
                    setProjectId(v)
                    setPhaseId('')
                  }}
                  options={[{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                />
              </div>
            )}
            {projectId && projectPhases.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Phase</div>
                <CustomSelect value={phaseId} onChange={setPhaseId} options={[{ value: '', label: 'No phase' }, ...projectPhases.map((p) => ({ value: p.id, label: p.name }))]} />
              </div>
            )}
            {isAdmin && clientBudgets.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Budget</div>
                <CustomSelect value={budgetId} onChange={setBudgetId} options={[{ value: '', label: 'No budget' }, ...clientBudgets.map((b) => ({ value: b.id, label: b.name }))]} />
              </div>
            )}
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Due date</div>
              <DatePicker value={dueDate} onChange={setDueDate} allowClear={false} />
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Priority</div>
              <CustomSelect value={priority} onChange={setPriority} options={PRIORITY.map((p) => ({ value: p, label: p }))} />
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Estimated hours</div>
              <input
                type="number"
                min="0"
                step="0.5"
                className="w-full rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm"
                placeholder="e.g. 2"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
              />
            </div>
          </div>

          {clientId && (
            <div className="rounded-[8px] border border-ink/10 bg-sand/40 px-3 py-2 mb-3 flex flex-col gap-2.5">
              {task.requested_by && <div className="text-xs text-sage">Added by the client from their portal.</div>}
              <Switch
                checked={forClient}
                onChange={setForClient}
                label="Client’s to-do"
                hint="Shows as “waiting on you” in their portal and morning email"
              />
              <Switch
                checked={inPortalViaProject || forClient || !!task.requested_by || clientVisible}
                disabled={inPortalViaProject || forClient || !!task.requested_by}
                onChange={setClientVisible}
                label="Show in the client’s portal"
                hint={inPortalViaProject ? 'Always - it’s in their project' : undefined}
              />
            </div>
          )}

          <div className="text-[10px] font-semibold tracking-wide text-sage/70 mb-1">Notes</div>
          <textarea
            className="w-full rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm mb-3 min-h-[90px]"
            placeholder="Add notes…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          {comments && (
            <div className="mb-3 border-t border-ink/8 pt-3">
              <TaskComments supabase={comments.supabase} taskId={task.id} orgId={comments.orgId} userId={comments.userId} />
              {clientId && !(inPortalViaProject || forClient || clientVisible || task.requested_by) && (
                <p className="text-[11px] text-sage mt-1">This task isn’t in the client’s portal, so comments stay with the team.</p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
            <div className="flex-1" />
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
