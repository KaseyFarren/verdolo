'use client'

import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import CustomSelect from '@/components/ui/CustomSelect'
import MultiSelect from '@/components/ui/MultiSelect'
import DatePicker from '@/components/ui/DatePicker'
import Avatar from '@/components/ui/Avatar'
import IconButton from '@/components/ui/IconButton'
import { AlertTriangleIcon, MoonIcon, PauseIcon, PlayIcon, SkipForwardIcon, TrashIcon } from '@/components/ui/icons'
import QuickAddTime from '@/components/QuickAddTime'
import { PRIORITY, priorityColor, todayKey } from '@/lib/agency'
import type { Client, Member, Task } from '@/app/(app)/tasks/TasksClient'

// Every column is minmax(0, ...) so the whole grid ALWAYS fits its container and never triggers
// horizontal scrolling - when space is tight the flexible (title/client) columns give first, then
// the capped ones shrink and their content truncates. No fixed px tracks, no overflow-x wrapper,
// no min-width. Actions get their own reserved (capped) column so they never overlap data columns.
// Notes are NOT a column (too cramped) - they render in a full-width bar under the row instead.
export const ROW_GRID_COLS =
  'grid-cols-[20px_24px_minmax(0,1fr)_minmax(0,60px)_minmax(0,116px)_minmax(0,132px)] lg:grid-cols-[20px_24px_minmax(0,2fr)_minmax(0,64px)_minmax(0,1fr)_minmax(0,60px)_minmax(0,128px)_minmax(0,64px)_minmax(0,132px)]'

export function TaskListHeader() {
  return (
    <div className={`grid ${ROW_GRID_COLS} gap-2 items-center pb-1.5 mb-1 border-b border-ink/10 text-[10px] font-semibold tracking-wide text-sage/70`}>
      <div />
      <div />
      <div>Title</div>
      <div className="hidden lg:block">Type</div>
      <div className="hidden lg:block">Client</div>
      <div>Assigned</div>
      <div>Due</div>
      <div className="hidden lg:block">Priority</div>
      <div />
    </div>
  )
}

export default function TaskRow({
  t,
  clients,
  members,
  updateField,
  onOpenDetail,
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
  clients: Client[]
  members: Member[]
  updateField: (field: string, value: unknown) => void
  onOpenDetail: () => void
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
  const [addingTime, setAddingTime] = useState(false)
  const [notesDraft, setNotesDraft] = useState(t.notes || '')
  // Resync the local notes draft when the task changes from outside this row (modal save, realtime,
  // switching tasks) - adjusting state during render instead of an effect avoids an extra render.
  const [syncedFor, setSyncedFor] = useState(`${t.id}:${t.notes || ''}`)
  const syncKey = `${t.id}:${t.notes || ''}`
  if (syncKey !== syncedFor) {
    setSyncedFor(syncKey)
    setNotesDraft(t.notes || '')
  }

  const openSubtasks = subtasks.filter((st) => !st.done)
  const hasOpenSubtasks = !isSubtask && openSubtasks.length > 0

  const assigneeIds = t.assignee_ids?.length ? t.assignee_ids : t.assigned_to ? [t.assigned_to] : []
  const isOverdue = !t.done && t.due_date < todayKey()
  const taskType = t.is_auto ? 'Default' : t.recurring_id ? 'Recurring' : ''

  return (
    <div>
      <motion.div
        layout
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: t.done ? 0.45 : 1, y: 0 }}
        exit={{ opacity: 0, x: -8 }}
        transition={{ duration: 0.15 }}
        className={`grid ${ROW_GRID_COLS} gap-2 items-center py-2 group ${t.notes ? '' : 'border-b border-ink/10'} ${isTimerRunning ? 'bg-green/5' : ''} ${isSubtask ? 'pl-6' : ''}`}
      >
        <button
          data-tour="task-checkbox"
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

        {!t.done &&
          (isTimerRunning ? (
            <IconButton data-tour="task-timer" label="Pause timer" tone="green" icon={<PauseIcon />} onClick={stopTimer} className="!p-1" />
          ) : (
            <IconButton data-tour="task-timer" label="Start timer" tone="accent" icon={<PlayIcon />} onClick={startTimer} className="!p-1" />
          ))}
        {t.done && <span />}

        <div className="flex items-center gap-1 min-w-0">
          {!isSubtask && subtasks.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-sage hover:text-ink shrink-0"
              title={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
            >
              {expanded ? '▾' : '▸'} {subtasks.filter((s) => s.done).length}/{subtasks.length}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenDetail}
            title="Open task details"
            className={`flex-1 min-w-0 truncate text-left text-sm hover:underline ${t.done ? 'line-through text-sage' : ''}`}
          >
            {t.title}
          </button>
          {isTimerRunning && (
            <span className="text-xs font-mono text-green inline-flex items-center gap-1 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" /> {elapsed}
            </span>
          )}
        </div>

        <div className="hidden lg:block min-w-0 text-xs text-sage truncate">{taskType}</div>

        <div className="hidden lg:block min-w-0 text-xs">
          <CustomSelect
            variant="plain"
            value={t.client_id || ''}
            onChange={(v) => updateField('client_id', v)}
            options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            className="text-sage"
          />
        </div>

        <div className="min-w-0 text-xs">
          <MultiSelect
            variant="plain"
            value={assigneeIds}
            onChange={(ids) => updateField('assignee_ids', ids)}
            options={members.map((m) => ({ value: m.user_id, label: m.display_name || m.invited_email || '-' }))}
            renderTrigger={(selected) =>
              selected.length === 0 ? (
                <span className="text-sage">—</span>
              ) : (
                <span className="flex items-center -space-x-1.5">
                  {selected.slice(0, 3).map((o) => (
                    <Avatar key={o.value} member={members.find((m) => m.user_id === o.value)} size={20} className="ring-2 ring-cream" />
                  ))}
                  {selected.length > 3 && <span className="text-[10px] text-sage ml-1.5">+{selected.length - 3}</span>}
                </span>
              )
            }
          />
        </div>

        <div className="flex items-center gap-1 min-w-0 text-xs">
          {isOverdue && <AlertTriangleIcon size={13} className="text-red-600 shrink-0" />}
          <DatePicker
            variant="plain"
            allowClear={false}
            value={t.due_date}
            onChange={(v) => updateField('due_date', v)}
            className={`flex-1 min-w-0 ${isOverdue ? 'text-red-600 font-medium' : 'text-sage'}`}
          />
        </div>

        <div className="hidden lg:block min-w-0 text-xs">
          {!t.quick && (
            <CustomSelect
              variant="plain"
              value={t.priority}
              onChange={(v) => updateField('priority', v)}
              options={PRIORITY.map((p) => ({ value: p, label: p }))}
              className={`font-medium ${priorityColor(t.priority)}`}
            />
          )}
        </div>

        {/* Actions reveal on hover (or always while a timer runs / time is being entered). While
            entering time only QuickAddTime shows, so its expanded input never overflows the cell
            into the priority column. */}
        <div
          data-tour="task-actions"
          className={`flex gap-1 shrink-0 items-center justify-end transition-opacity ${
            isTimerRunning || addingTime ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
        >
          {!t.done && !isTimerRunning && <QuickAddTime onAdd={addManualTime} onOpenChange={setAddingTime} />}
          {!addingTime && (
            <>
              {!t.done && <IconButton label="Snooze - push to tomorrow" tone="sage" icon={<MoonIcon />} onClick={snooze} />}
              {!t.done && skip && <IconButton label="Skip this occurrence" tone="accent" icon={<SkipForwardIcon />} onClick={skip} />}
              <IconButton label="Delete" tone="red" icon={<TrashIcon />} onClick={del} />
            </>
          )}
        </div>
      </motion.div>

      {/* Notes belong WITH their task, so the row above has no bottom border when notes exist -
          the group's divider is this bar's bottom border instead, and the note reads as attached
          text under the title (borderless until hover/focus) rather than a separate boxed item.
          Add notes to a note-less task via the detail modal (click the title). */}
      {t.notes && (
        <div className="border-b border-ink/10 pb-2">
          <div className={isSubtask ? 'pl-[84px] pr-2' : 'pl-[60px] pr-2'}>
            <input
              className="w-full text-xs text-sage bg-transparent rounded-md border border-transparent px-2 py-1 outline-none hover:border-ink/10 focus:border-ink/20 focus:bg-white focus:text-ink"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={() => {
                if (notesDraft !== (t.notes || '')) updateField('notes', notesDraft)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </div>
        </div>
      )}

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
