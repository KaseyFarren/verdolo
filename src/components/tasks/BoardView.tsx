'use client'

import { useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { toast } from 'sonner'
import TaskCard from './TaskCard'
import type { Client, Member, Task, TaskStatus } from '@/app/(app)/tasks/TasksClient'

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'in_review', label: 'In Review' },
  { key: 'done', label: 'Done' },
]

function sortColumn(items: Task[]): Task[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order || a.due_date.localeCompare(b.due_date))
}

// Fractional position between the two neighbors the card lands between, so a drop never needs to
// renumber the rest of the column (see supabase/migrations/0071_task_status_and_order.sql).
function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before !== undefined && after !== undefined) return (before + after) / 2
  if (before !== undefined) return before + 1
  if (after !== undefined) return after - 1
  return 0
}

function Column({ status, label, tasks, children }: { status: TaskStatus; label: string; tasks: Task[]; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `column:${status}` })
  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs font-semibold tracking-wide text-sage/70">{label}</span>
        <span className="text-xs text-sage/70">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className="flex-1 min-h-[80px] rounded-lg bg-sand/60 p-2">
        {children}
      </div>
    </div>
  )
}

export default function BoardView({
  tasks,
  clients,
  members,
  subtasksByParent,
  updateTask,
  completeTask,
  uncompleteTask,
  onOpenDetail,
}: {
  tasks: Task[]
  clients: Client[]
  members: Member[]
  subtasksByParent: Map<string, Task[]>
  updateTask: (id: string, fields: Record<string, unknown>) => Promise<void>
  completeTask: (t: Task, extra?: Record<string, unknown>) => Promise<void>
  uncompleteTask: (t: Task, extra?: Record<string, unknown>) => Promise<void>
  onOpenDetail: (id: string) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const byColumn = new Map<TaskStatus, Task[]>(COLUMNS.map((c) => [c.key, sortColumn(tasks.filter((t) => t.status === c.key))]))
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
    const targetStatus: TaskStatus = overId.startsWith('column:') ? (overId.slice('column:'.length) as TaskStatus) : (tasks.find((t) => t.id === overId)?.status ?? task.status)

    if (targetStatus === 'done') {
      const openSubtasks = (subtasksByParent.get(task.id) || []).filter((s) => !s.done)
      if (openSubtasks.length > 0) {
        toast.error(`Complete ${openSubtasks.length} subtask${openSubtasks.length === 1 ? '' : 's'} first`)
        return
      }
    }

    const columnTasks = (byColumn.get(targetStatus) || []).filter((t) => t.id !== task.id)
    const overIndex = overId.startsWith('column:') ? columnTasks.length : columnTasks.findIndex((t) => t.id === overId)
    const insertIndex = overIndex === -1 ? columnTasks.length : overIndex
    const newOrder = orderBetween(columnTasks[insertIndex - 1]?.sort_order, columnTasks[insertIndex]?.sort_order)

    if (targetStatus === 'done' && task.status !== 'done') await completeTask(task, { sort_order: newOrder })
    else if (targetStatus !== 'done' && task.status === 'done') await uncompleteTask(task, { status: targetStatus, sort_order: newOrder })
    else await updateTask(task.id, { status: targetStatus, sort_order: newOrder })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {COLUMNS.map((col) => {
          const colTasks = byColumn.get(col.key) || []
          return (
            <Column key={col.key} status={col.key} label={col.label} tasks={colTasks}>
              <SortableContext items={colTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {colTasks.map((t) => {
                  const subtasks = subtasksByParent.get(t.id) || []
                  return (
                    <TaskCard
                      key={t.id}
                      t={t}
                      clients={clients}
                      members={members}
                      onOpenDetail={() => onOpenDetail(t.id)}
                      subtaskCount={subtasks.length}
                      openSubtaskCount={subtasks.filter((s) => !s.done).length}
                    />
                  )
                })}
                {colTasks.length === 0 && <div className="text-xs text-sage/50 text-center py-4">No tasks</div>}
              </SortableContext>
            </Column>
          )
        })}
      </div>
      <DragOverlay>
        {activeTask && (
          <TaskCard
            t={activeTask}
            clients={clients}
            members={members}
            onOpenDetail={() => {}}
            subtaskCount={(subtasksByParent.get(activeTask.id) || []).length}
            openSubtaskCount={(subtasksByParent.get(activeTask.id) || []).filter((s) => !s.done).length}
          />
        )}
      </DragOverlay>
    </DndContext>
  )
}
