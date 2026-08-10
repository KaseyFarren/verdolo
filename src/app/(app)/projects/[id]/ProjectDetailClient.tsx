'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import { useTaskTimer } from '@/lib/useTaskTimer'
import { markSelfAssigned } from '@/lib/selfNotify'
import { orderBetween } from '@/lib/sortOrder'
import PhaseSection from '@/components/projects/PhaseSection'
import SortableTaskRow from '@/components/projects/SortableTaskRow'
import ProjectFormModal, { type ProjectFormValues } from '@/components/projects/ProjectFormModal'
import TaskDetailModal from '@/components/tasks/TaskDetailModal'
import TaskCard from '@/components/tasks/TaskCard'
import AddTaskFormMulti, { type TaskFormStateMulti } from '@/components/tasks/AddTaskFormMulti'
import Button from '@/components/ui/Button'
import IconButton from '@/components/ui/IconButton'
import CustomSelect from '@/components/ui/CustomSelect'
import { PencilIcon, PlusIcon, TrashIcon } from '@/components/ui/icons'
import { formatDate, getOffsetDate, todayKey } from '@/lib/agency'
import type { Budget, Client, Member, Task } from '@/app/(app)/tasks/TasksClient'

type ProjectFull = {
  id: string
  client_id: string | null
  budget_id: string | null
  name: string
  description: string | null
  status: string
  start_date: string | null
  due_date: string | null
}
// Richer than the {id, project_id, name} Phase shape TaskDetailModal needs - this view also
// drives phase reordering (Move up/down), so it keeps sort_order.
type ProjectPhase = { id: string; project_id: string; name: string; sort_order: number }

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
]

const emptyTaskForm: TaskFormStateMulti = { title: '', clientId: '', assigneeIds: [], dueDate: todayKey(), priority: '', notes: '', estimatedHours: '' }

export default function ProjectDetailClient({
  orgId,
  userId,
  isAdmin,
  initialProject,
  initialPhases,
  initialTasks,
  clients,
  members,
  budgets,
}: {
  orgId: string
  userId: string
  isAdmin: boolean
  initialProject: ProjectFull
  initialPhases: ProjectPhase[]
  initialTasks: Task[]
  clients: Client[]
  members: Member[]
  budgets: Budget[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const confirm = useConfirm()
  const timer = useTaskTimer(supabase, orgId, userId)

  const [project, setProject] = useState(initialProject)
  const [phases, setPhases] = useState<ProjectPhase[]>(initialPhases)
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [addingTaskFor, setAddingTaskFor] = useState<string | null>(null)
  const [taskForm, setTaskForm] = useState<TaskFormStateMulti>(emptyTaskForm)
  const [addingSubtaskFor, setAddingSubtaskFor] = useState<string | null>(null)
  const [subtaskForm, setSubtaskForm] = useState<TaskFormStateMulti>(emptyTaskForm)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [showEditProject, setShowEditProject] = useState(false)
  const [addingPhase, setAddingPhase] = useState(false)
  const [phaseDraft, setPhaseDraft] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // Realtime: keep this project's phases and tasks synced for every viewer, and drop back to
  // /projects if someone else deletes the project out from under this tab.
  useEffect(() => {
    const channel = supabase
      .channel(`project-${project.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${project.id}` }, (payload) => {
        setProject(payload.new as ProjectFull)
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'projects', filter: `id=eq.${project.id}` }, () => {
        toast('This project was deleted')
        router.push('/projects')
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_phases', filter: `project_id=eq.${project.id}` }, (payload) => {
        const incoming = payload.new as ProjectPhase
        setPhases((prev) => (prev.some((p) => p.id === incoming.id) ? prev : [...prev, incoming].sort((a, b) => a.sort_order - b.sort_order)))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'project_phases', filter: `project_id=eq.${project.id}` }, (payload) => {
        const incoming = payload.new as ProjectPhase
        setPhases((prev) => prev.map((p) => (p.id === incoming.id ? incoming : p)).sort((a, b) => a.sort_order - b.sort_order))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'project_phases', filter: `project_id=eq.${project.id}` }, (payload) => {
        const old = payload.old as { id: string }
        setPhases((prev) => prev.filter((p) => p.id !== old.id))
        setTasks((prev) => prev.map((t) => (t.phase_id === old.id ? { ...t, phase_id: null } : t)))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `project_id=eq.${project.id}` }, (payload) => {
        const incoming = payload.new as Task
        setTasks((prev) => (prev.some((t) => t.id === incoming.id) ? prev : [...prev, incoming]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `project_id=eq.${project.id}` }, (payload) => {
        const incoming = payload.new as Task
        setTasks((prev) => (prev.some((t) => t.id === incoming.id) ? prev.map((t) => (t.id === incoming.id ? incoming : t)) : [...prev, incoming]))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks', filter: `project_id=eq.${project.id}` }, (payload) => {
        const old = payload.old as { id: string }
        setTasks((prev) => prev.filter((t) => t.id !== old.id))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, project.id, supabase])

  const effectiveAssignees = (t: Task) => (t.assignee_ids?.length ? t.assignee_ids : t.assigned_to ? [t.assigned_to] : [])
  function deriveAssignedTo(ids: string[]): string | null {
    return ids[0] ?? null
  }

  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (t.parent_task_id && !t.skipped) {
        const arr = map.get(t.parent_task_id) || []
        arr.push(t)
        map.set(t.parent_task_id, arr)
      }
    }
    return map
  }, [tasks])

  // Top-level tasks (not subtasks, not skipped), grouped into their phase - unphased tasks land
  // in a synthetic "no phase yet" bucket at the top so nothing silently disappears.
  const topLevel = tasks.filter((t) => !t.parent_task_id && !t.skipped)
  function tasksForPhase(phaseId: string | null): Task[] {
    return topLevel
      .filter((t) => t.phase_id === phaseId && (!hideCompleted || !t.done))
      .sort((a, b) => a.sort_order - b.sort_order || (a.due_date || '').localeCompare(b.due_date || ''))
  }
  const unphased = tasksForPhase(null)

  const totalTasks = topLevel.length
  const doneTasks = topLevel.filter((t) => t.done).length

  async function updateTask(id: string, fields: Record<string, unknown>) {
    if ((Array.isArray(fields.assignee_ids) && (fields.assignee_ids as string[]).includes(userId)) || fields.assigned_to === userId) markSelfAssigned(id)
    let prevTask: Task | undefined
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        prevTask = t
        return { ...t, ...fields } as Task
      }),
    )
    const { data, error } = await supabase.from('tasks').update(fields).eq('id', id).select().single()
    if (error) {
      if (prevTask) setTasks((prev) => prev.map((t) => (t.id === id ? (prevTask as Task) : t)))
      toast.error('Could not save that change')
      return
    }
    if (data) setTasks((prev) => prev.map((t) => (t.id === id ? (data as Task) : t)))
  }

  async function completeTask(t: Task, extra: Record<string, unknown> = {}) {
    const completedAt = new Date().toISOString()
    await timer.stopIfRunningFor(t.id)
    const claim = effectiveAssignees(t).length === 0 ? { assignee_ids: [userId], assigned_to: userId } : {}
    await updateTask(t.id, { done: true, completed_at: completedAt, status: 'done', ...claim, ...extra })
  }
  async function uncompleteTask(t: Task, extra: Record<string, unknown> = {}) {
    await updateTask(t.id, { done: false, completed_at: null, status: 'todo', ...extra })
  }

  function deleteTask(id: string) {
    const removed = tasks.find((t) => t.id === id)
    if (!removed) return
    const removedSubtasks = tasks.filter((t) => t.parent_task_id === id)
    const isGenerated = !!(removed.recurring_id || removed.is_auto || removed.default_template_id)
    setTasks((prev) => prev.filter((t) => t.id !== id && t.parent_task_id !== id))
    const timeoutId = setTimeout(async () => {
      if (isGenerated) await supabase.from('tasks').update({ skipped: true }).eq('id', id)
      else await supabase.from('tasks').delete().eq('id', id)
    }, 5000)
    toast('Task deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timeoutId)
          setTasks((prev) => [...prev, removed, ...removedSubtasks])
        },
      },
    })
  }
  async function snoozeTask(t: Task) {
    await updateTask(t.id, { due_date: getOffsetDate(1), done: false })
  }

  async function addManualTimeForTask(task: Task, hours: number) {
    const durationSeconds = Math.round(hours * 3600)
    const endedAt = new Date()
    const startedAt = new Date(endedAt.getTime() - durationSeconds * 1000)
    const { error } = await supabase.from('time_entries').insert({
      org_id: orgId,
      client_id: task.client_id,
      task_id: task.id,
      user_id: userId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      billable: true,
    })
    if (error) toast.error('Failed to log time')
    else toast.success(`${hours}h logged`)
  }

  async function addTaskToPhase(phaseId: string | null) {
    if (!taskForm.title.trim()) return
    const assigneeIds = taskForm.assigneeIds
    const id = crypto.randomUUID()
    if (assigneeIds.includes(userId)) markSelfAssigned(id)
    const siblingOrders = tasksForPhase(phaseId).map((t) => t.sort_order)
    const sortOrder = siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0
    const insertRow = {
      id,
      org_id: orgId,
      project_id: project.id,
      phase_id: phaseId,
      title: taskForm.title,
      client_id: taskForm.clientId || project.client_id || null,
      assignee_ids: assigneeIds,
      assigned_to: deriveAssignedTo(assigneeIds),
      due_date: taskForm.dueDate || todayKey(),
      priority: taskForm.priority || 'Medium',
      notes: taskForm.notes,
      estimated_hours: taskForm.estimatedHours ? Number(taskForm.estimatedHours) : null,
      quick: false,
      done: false,
      sort_order: sortOrder,
    }
    const optimisticRow: Task = {
      ...insertRow,
      parent_task_id: null,
      completed_at: null,
      is_auto: false,
      auto_type: null,
      recurring_id: null,
      default_template_id: null,
      skipped: false,
      status: 'todo',
    }
    setTasks((prev) => [...prev, optimisticRow])
    setTaskForm(emptyTaskForm)
    setAddingTaskFor(null)
    const { data, error } = await supabase.from('tasks').insert(insertRow).select().single()
    if (error) {
      setTasks((prev) => prev.filter((t) => t.id !== id))
      toast.error('Could not add that task')
      return
    }
    if (data) setTasks((prev) => prev.map((t) => (t.id === id ? (data as Task) : t)))
  }

  async function addSubtask(parentId: string) {
    const parent = tasks.find((t) => t.id === parentId)
    if (!subtaskForm.title.trim() || !parent) return
    const assigneeIds = subtaskForm.assigneeIds
    const id = crypto.randomUUID()
    if (assigneeIds.includes(userId)) markSelfAssigned(id)
    const insertRow = {
      id,
      org_id: orgId,
      project_id: parent.project_id,
      phase_id: parent.phase_id,
      title: subtaskForm.title,
      client_id: subtaskForm.clientId || parent.client_id || null,
      assignee_ids: assigneeIds,
      assigned_to: deriveAssignedTo(assigneeIds),
      due_date: subtaskForm.dueDate || todayKey(),
      priority: subtaskForm.priority || 'Medium',
      notes: subtaskForm.notes,
      estimated_hours: subtaskForm.estimatedHours ? Number(subtaskForm.estimatedHours) : null,
      quick: false,
      done: false,
      parent_task_id: parentId,
    }
    const optimisticRow: Task = {
      ...insertRow,
      completed_at: null,
      is_auto: false,
      auto_type: null,
      recurring_id: null,
      default_template_id: null,
      skipped: false,
      status: 'todo',
      sort_order: 0,
    }
    setTasks((prev) => [...prev, optimisticRow])
    setSubtaskForm(emptyTaskForm)
    setAddingSubtaskFor(null)
    const { data, error } = await supabase.from('tasks').insert(insertRow).select().single()
    if (error) {
      setTasks((prev) => prev.filter((t) => t.id !== id))
      toast.error('Could not add that subtask')
      return
    }
    if (data) setTasks((prev) => prev.map((t) => (t.id === id ? (data as Task) : t)))
  }

  function renderTaskRow(t: Task, isSubtask = false) {
    const childSubtasks = isSubtask ? [] : subtasksByParent.get(t.id) || []
    return (
      <SortableTaskRow
        key={t.id}
        t={t}
        clients={clients}
        members={members}
        projects={[{ id: project.id, name: project.name, client_id: project.client_id }]}
        updateField={(field, value) => {
          if (field === 'assignee_ids') {
            const assigneeIds = value as string[]
            updateTask(t.id, { assignee_ids: assigneeIds, assigned_to: deriveAssignedTo(assigneeIds) })
          } else if (field === 'client_id') {
            updateTask(t.id, { client_id: (value as string) || null })
          } else {
            updateTask(t.id, { [field]: value })
          }
        }}
        onOpenDetail={() => setDetailTaskId(t.id)}
        complete={() => completeTask(t)}
        uncomplete={() => uncompleteTask(t)}
        del={() => deleteTask(t.id)}
        snooze={() => snoozeTask(t)}
        skip={t.is_auto || t.recurring_id ? () => updateTask(t.id, { done: true, skipped: true }) : undefined}
        isTimerRunning={timer.running?.task_id === t.id}
        elapsed={timer.elapsedFor(t.id)}
        startTimer={() => timer.startForTask(t)}
        stopTimer={() => timer.stopRunning()}
        addManualTime={(hours) => addManualTimeForTask(t, hours)}
        isSubtask={isSubtask}
        subtasks={childSubtasks}
        subtaskRows={!isSubtask ? childSubtasks.map((st) => renderTaskRow(st, true)) : undefined}
        isAddingSubtask={!isSubtask && addingSubtaskFor === t.id}
        onAddSubtask={
          isSubtask
            ? undefined
            : () => {
                setAddingSubtaskFor(t.id)
                setSubtaskForm({ ...emptyTaskForm, clientId: t.client_id || '', dueDate: t.due_date })
              }
        }
        addSubtaskForm={
          !isSubtask && addingSubtaskFor === t.id ? (
            <AddTaskFormMulti
              mode="quick"
              setMode={() => {}}
              forceDetailed
              form={subtaskForm}
              setForm={setSubtaskForm}
              clients={clients}
              members={members}
              onSubmit={() => addSubtask(t.id)}
              onCancel={() => setAddingSubtaskFor(null)}
              submitLabel="Add subtask"
            />
          ) : undefined
        }
      />
    )
  }

  // ---- Phase CRUD ----
  async function addPhase() {
    if (!phaseDraft.trim()) return
    const sortOrder = phases.length ? Math.max(...phases.map((p) => p.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('project_phases')
      .insert({ org_id: orgId, project_id: project.id, name: phaseDraft.trim(), sort_order: sortOrder })
      .select()
      .single()
    if (error || !data) {
      toast.error('Could not add phase')
      return
    }
    setPhases((prev) => [...prev, data as ProjectPhase])
    setPhaseDraft('')
    setAddingPhase(false)
  }
  async function renamePhase(id: string, name: string) {
    setPhases((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
    const { error } = await supabase.from('project_phases').update({ name }).eq('id', id)
    if (error) toast.error('Could not rename phase')
  }
  async function deletePhase(id: string) {
    const phase = phases.find((p) => p.id === id)
    if (!phase) return
    const count = tasksForPhase(id).length
    const ok = await confirm({
      title: 'Delete phase',
      message: count > 0 ? `Delete "${phase.name}"? ${count} task${count === 1 ? '' : 's'} will move to "No phase" - they stay in the project.` : `Delete "${phase.name}"?`,
      danger: true,
    })
    if (!ok) return
    setPhases((prev) => prev.filter((p) => p.id !== id))
    setTasks((prev) => prev.map((t) => (t.phase_id === id ? { ...t, phase_id: null } : t)))
    const { error } = await supabase.from('project_phases').delete().eq('id', id)
    if (error) toast.error('Could not delete phase')
  }
  async function movePhase(id: string, direction: 'up' | 'down') {
    const sorted = [...phases].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex((p) => p.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[swapIdx]
    setPhases((prev) => prev.map((p) => (p.id === a.id ? { ...p, sort_order: b.sort_order } : p.id === b.id ? { ...p, sort_order: a.sort_order } : p)))
    await Promise.all([
      supabase.from('project_phases').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('project_phases').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
  }

  // ---- Project CRUD ----
  async function saveProject(values: ProjectFormValues) {
    const { data, error } = await supabase.from('projects').update(values).eq('id', project.id).select().single()
    if (error || !data) {
      toast.error('Could not save project')
      return
    }
    setProject(data as ProjectFull)
    setShowEditProject(false)
  }
  async function deleteProject() {
    const ok = await confirm({ title: 'Delete project', message: `Delete "${project.name}"? Its phases go with it, but tasks stay - they just lose their project.`, danger: true })
    if (!ok) return
    const { error } = await supabase.from('projects').delete().eq('id', project.id)
    if (error) {
      toast.error('Could not delete project')
      return
    }
    toast.success('Project deleted')
    router.push('/projects')
  }
  async function setProjectStatus(status: string) {
    setProject((prev) => ({ ...prev, status }))
    const { error } = await supabase.from('projects').update({ status }).eq('id', project.id)
    if (error) toast.error('Could not update status')
  }

  // ---- Drag and drop ----
  const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order)
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  function handleDragStart(e: DragStartEvent) {
    setActiveId(e.active.id as string)
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const task = tasks.find((t) => t.id === active.id)
    if (!task) return

    const overId = over.id as string
    const targetPhaseId: string | null = overId.startsWith('phase:')
      ? overId.slice('phase:'.length) === 'none'
        ? null
        : overId.slice('phase:'.length)
      : (tasks.find((t) => t.id === overId)?.phase_id ?? task.phase_id ?? null)

    const columnTasks = tasksForPhase(targetPhaseId).filter((t) => t.id !== task.id)
    const overIndex = overId.startsWith('phase:') ? columnTasks.length : columnTasks.findIndex((t) => t.id === overId)
    const insertIndex = overIndex === -1 ? columnTasks.length : overIndex
    const newOrder = orderBetween(columnTasks[insertIndex - 1]?.sort_order, columnTasks[insertIndex]?.sort_order)

    await updateTask(task.id, { phase_id: targetPhaseId, sort_order: newOrder })
    // Move subtasks along with their parent so a phase never ends up with a half-moved family.
    const kids = subtasksByParent.get(task.id) || []
    for (const kid of kids) await updateTask(kid.id, { phase_id: targetPhaseId })
  }

  const clientName = clients.find((c) => c.id === project.client_id)?.name

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Link href="/projects" className="text-xs text-sage hover:text-ink">
        &larr; Projects
      </Link>

      <div className="flex items-start justify-between gap-3 mt-2 mb-1 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">{project.name}</h1>
          <div className="text-xs text-sage mt-1 flex items-center gap-2 flex-wrap">
            {clientName && <span>{clientName}</span>}
            {project.due_date && <span>Due {formatDate(project.due_date)}</span>}
            {totalTasks > 0 && (
              <span>
                {doneTasks}/{totalTasks} tasks done
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CustomSelect value={project.status} onChange={setProjectStatus} options={STATUS_OPTIONS} className="w-32" />
          <IconButton label="Edit project" icon={<PencilIcon size={14} />} onClick={() => setShowEditProject(true)} />
          <IconButton label="Delete project" tone="red" icon={<TrashIcon size={14} />} onClick={deleteProject} />
        </div>
      </div>

      {project.description && <p className="text-sm text-sage mb-3 whitespace-pre-wrap">{project.description}</p>}

      <div className="flex items-center justify-end mb-4">
        <button type="button" className="text-xs text-sage hover:text-ink" onClick={() => setHideCompleted((v) => !v)}>
          {hideCompleted ? 'Show completed' : 'Hide completed'}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {(unphased.length > 0 || phases.length > 0) && (
          <PhaseSection
            phase={{ id: 'none', name: 'No phase' }}
            taskIds={unphased.map((t) => t.id)}
            doneCount={unphased.filter((t) => t.done).length}
            totalCount={unphased.length}
            canMoveUp={false}
            canMoveDown={false}
            onRename={() => {}}
            onMoveUp={() => {}}
            onMoveDown={() => {}}
            onDelete={() => {}}
            isAddingTask={addingTaskFor === 'none'}
            onStartAddTask={() => {
              setAddingTaskFor('none')
              setTaskForm({ ...emptyTaskForm, clientId: project.client_id || '' })
            }}
            addTaskForm={
              <AddTaskFormMulti
                mode="quick"
                setMode={() => {}}
                forceDetailed
                form={taskForm}
                setForm={setTaskForm}
                clients={clients}
                members={members}
                onSubmit={() => addTaskToPhase(null)}
                onCancel={() => setAddingTaskFor(null)}
              />
            }
          >
            {unphased.map((t) => renderTaskRow(t))}
          </PhaseSection>
        )}

        {sortedPhases.map((phase, i) => {
          const phaseTasks = tasksForPhase(phase.id)
          return (
            <PhaseSection
              key={phase.id}
              phase={phase}
              taskIds={phaseTasks.map((t) => t.id)}
              doneCount={phaseTasks.filter((t) => t.done).length}
              totalCount={phaseTasks.length}
              canMoveUp={i > 0}
              canMoveDown={i < sortedPhases.length - 1}
              onRename={(name) => renamePhase(phase.id, name)}
              onMoveUp={() => movePhase(phase.id, 'up')}
              onMoveDown={() => movePhase(phase.id, 'down')}
              onDelete={() => deletePhase(phase.id)}
              isAddingTask={addingTaskFor === phase.id}
              onStartAddTask={() => {
                setAddingTaskFor(phase.id)
                setTaskForm({ ...emptyTaskForm, clientId: project.client_id || '' })
              }}
              addTaskForm={
                <AddTaskFormMulti
                  mode="quick"
                  setMode={() => {}}
                  forceDetailed
                  form={taskForm}
                  setForm={setTaskForm}
                  clients={clients}
                  members={members}
                  onSubmit={() => addTaskToPhase(phase.id)}
                  onCancel={() => setAddingTaskFor(null)}
                />
              }
            >
              {phaseTasks.map((t) => renderTaskRow(t))}
            </PhaseSection>
          )
        })}

        <DragOverlay>{activeTask && <TaskCard t={activeTask} clients={clients} members={members} onOpenDetail={() => {}} subtaskCount={0} openSubtaskCount={0} />}</DragOverlay>
      </DndContext>

      {addingPhase ? (
        <div className="flex items-center gap-2 mt-2">
          <input
            autoFocus
            className="rounded-[8px] border border-ink/10 bg-white px-3 py-1.5 text-sm"
            placeholder="Phase name"
            value={phaseDraft}
            onChange={(e) => setPhaseDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addPhase()
              if (e.key === 'Escape') setAddingPhase(false)
            }}
          />
          <Button variant="primary" size="sm" onClick={addPhase}>
            Add
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAddingPhase(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => setAddingPhase(true)} className="flex items-center gap-1 text-sm text-accent font-medium mt-2">
          <PlusIcon size={13} /> Add phase
        </button>
      )}

      {showEditProject && (
        <ProjectFormModal initial={project} clients={clients} budgets={budgets} onSave={saveProject} onClose={() => setShowEditProject(false)} />
      )}

      {detailTaskId && tasks.find((t) => t.id === detailTaskId) && (
        <TaskDetailModal
          task={tasks.find((t) => t.id === detailTaskId) as Task}
          clients={clients}
          members={members}
          budgets={budgets}
          projects={[{ id: project.id, name: project.name, client_id: project.client_id }]}
          phases={phases.map((p) => ({ id: p.id, project_id: project.id, name: p.name }))}
          isAdmin={isAdmin}
          effectiveAssignees={effectiveAssignees}
          onSave={(fields) => updateTask(detailTaskId, { ...fields, assigned_to: deriveAssignedTo(fields.assignee_ids) })}
          onDelete={() => {
            deleteTask(detailTaskId)
            setDetailTaskId(null)
          }}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  )
}
