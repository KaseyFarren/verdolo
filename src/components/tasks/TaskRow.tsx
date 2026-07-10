'use client'

import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import TaskEditFormMulti from '@/components/tasks/TaskEditFormMulti'
import IconButton from '@/components/ui/IconButton'
import { ClockArrowIcon, PauseIcon, PencilIcon, PlayIcon, SkipForwardIcon, TrashIcon } from '@/components/ui/icons'
import QuickAddTime from '@/components/QuickAddTime'
import { formatDate } from '@/lib/agency'
import type { Client, Member, Task } from '@/app/(app)/tasks/TasksClient'

const ROW_GRID_COLS =
  'grid-cols-[20px_minmax(0,3fr)_100px_70px_minmax(0,1fr)_auto] md:grid-cols-[20px_minmax(0,3fr)_100px_100px_70px_60px_minmax(0,1fr)_auto]'

export default function TaskRow({
  t,
  clientName,
  memberEmail,
  isEditing,
  editForm,
  setEditForm,
  clients,
  members,
  startEdit,
  cancelEdit,
  save,
  complete,
  uncomplete,
  del,
  snooze,
  skip,
  isTimerRunning,
  elapsed,
  startTimer,
  stopTimer,
  addManualTime,
  isSubtask = false,
  subtasks = [],
  subtaskRows,
  isAddingSubtask = false,
  onAddSubtask,
  addSubtaskForm,
}: {
  t: Task
  clientName: (id: string | null) => string
  memberEmail: (id: string | null) => string
  isEditing: boolean
  editForm: Record<string, unknown>
  setEditForm: (f: (prev: Record<string, unknown>) => Record<string, unknown>) => void
  clients: Client[]
  members: Member[]
  startEdit: () => void
  cancelEdit: () => void
  save: () => void
  complete: () => void
  uncomplete: () => void
  del: () => void
  snooze: () => void
  skip?: () => void
  isTimerRunning: boolean
  elapsed: string | null
  startTimer: () => void
  stopTimer: () => void
  addManualTime: (hours: number) => void | Promise<void>
  isSubtask?: boolean
  subtasks?: Task[]
  subtaskRows?: ReactNode
  isAddingSubtask?: boolean
  onAddSubtask?: () => void
  addSubtaskForm?: ReactNode
}) {
  const [expanded, setExpanded] = useState(true)

  const openSubtasks = subtasks.filter((st) => !st.done)
  const hasOpenSubtasks = !isSubtask && openSubtasks.length > 0

  const assigneeIds = t.assignee_ids?.length ? t.assignee_ids : t.assigned_to ? [t.assigned_to] : []
  const assigneeLabel = assigneeIds.length ? assigneeIds.map(memberEmail).join(', ') : '—'

  const priorityColor = t.priority === 'High' ? 'text-red-600' : t.priority === 'Medium' ? 'text-amber-700' : 'text-green'

  const row = isEditing ? (
    <TaskEditFormMulti editForm={editForm} setEditForm={setEditForm} clients={clients} members={members} showDueDate={!t.is_auto} onCancel={cancelEdit} onSave={save} />
  ) : (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: t.done ? 0.45 : 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className={`grid ${ROW_GRID_COLS} gap-3 items-center py-2 border-b border-ink/10 group ${isTimerRunning ? 'bg-green/5' : ''} ${isSubtask ? 'pl-6' : ''}`}
    >
      <button
        onClick={() => {
          if (!t.done && hasOpenSubtasks) return
          if (t.done) uncomplete()
          else complete()
        }}
        title={hasOpenSubtasks && !t.done ? `Complete ${openSubtasks.length} subtask${openSubtasks.length === 1 ? '' : 's'} first` : isTimerRunning ? 'Mark done - stops the running timer' : undefined}
        className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
          t.done ? 'bg-green border-green' : isTimerRunning ? 'border-green ring-2 ring-green/30' : 'border-ink/25'
        } ${hasOpenSubtasks && !t.done ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {t.done && <span className="text-[10px] text-white">✓</span>}
      </button>

      <div className="text-sm min-w-0 truncate">
        {!isSubtask && subtasks.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mr-1 text-xs text-sage hover:text-ink align-middle"
            title={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          >
            {expanded ? '▾' : '▸'} {subtasks.filter((s) => s.done).length}/{subtasks.length}
          </button>
        )}
        <span className={t.done ? 'line-through text-sage' : ''}>{t.title}</span>
        {t.is_auto && <span className="ml-1 text-xs text-sage">auto</span>}
        {t.recurring_id && <span className="ml-1 text-xs text-sage">↻</span>}
        {isTimerRunning && (
          <span className="ml-2 text-xs font-mono text-green inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" /> {elapsed}
          </span>
        )}
        {t.done && t.completed_at && (
          <span className="ml-2 text-xs text-green">
            Done{' '}
            {new Date(t.completed_at).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>

      <div className="hidden md:block text-xs text-sage truncate">{t.client_id ? clientName(t.client_id) : ''}</div>

      <div className="text-xs text-sage truncate" title={assigneeLabel}>
        {assigneeLabel}
      </div>

      <div className="text-xs text-sage whitespace-nowrap">{formatDate(t.due_date)}</div>

      <div className={`hidden md:block text-xs font-medium ${priorityColor}`}>{!t.quick ? t.priority : ''}</div>

      <div className="text-xs text-sage truncate" title={t.notes || undefined}>
        {t.notes}
      </div>

      <div className={`flex gap-0.5 shrink-0 items-center ${isTimerRunning ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}>
        {!t.done &&
          (isTimerRunning ? (
            <IconButton label="Pause timer" tone="green" icon={<PauseIcon />} onClick={stopTimer} />
          ) : (
            <IconButton label="Start timer" tone="sage" icon={<PlayIcon />} onClick={startTimer} />
          ))}
        {!t.done && !isTimerRunning && <QuickAddTime onAdd={addManualTime} />}
        {!t.done && <IconButton label="Snooze - push to tomorrow" tone="sage" icon={<ClockArrowIcon />} onClick={snooze} />}
        {!t.done && skip && <IconButton label="Skip this occurrence" tone="sage" icon={<SkipForwardIcon />} onClick={skip} />}
        <IconButton label="Edit" tone="sage" icon={<PencilIcon />} onClick={startEdit} />
        <IconButton label="Delete" tone="red" icon={<TrashIcon />} onClick={del} />
      </div>
    </motion.div>
  )

  return (
    <div>
      {row}
      {!isSubtask && expanded && (subtasks.length > 0 || isAddingSubtask) && (
        <div>
          {subtaskRows}
          {isAddingSubtask && addSubtaskForm}
        </div>
      )}
      {!isSubtask && !isAddingSubtask && (
        <button type="button" onClick={onAddSubtask} className="pl-6 text-xs text-sage hover:text-ink py-1">
          + Add subtask
        </button>
      )}
    </div>
  )
}
