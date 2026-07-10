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

// Actions live in a real reserved trailing column (fixed width) rather than an absolute overlay -
// the overlay approach floated over and hid the Priority/Notes columns on hover. The column stays
// empty (just whitespace) until the row is hovered, so nothing is ever covered. Its fixed width is
// accounted for in ROW_MIN_WIDTH so the row scrolls rather than clipping when the window is narrow.
export const ROW_GRID_COLS =
  'grid-cols-[20px_24px_minmax(0,3fr)_90px_100px_minmax(0,1fr)_150px] md:grid-cols-[20px_24px_minmax(0,3fr)_80px_110px_90px_100px_70px_minmax(0,1fr)_150px]'
// Below this, the row's fixed-width columns no longer fit even with type/client/priority hidden -
// the row list wraps in overflow-x-auto at this width so it scrolls instead of silently clipping.
export const ROW_MIN_WIDTH = 'min-w-0 md:min-w-[920px]'

const PLAIN_FIELD = 'bg-transparent border border-transparent rounded px-1 -mx-1 outline-none hover:border-ink/10 focus:border-ink/20 focus:bg-white'

export function TaskListHeader() {
  return (
    <div className={`grid ${ROW_GRID_COLS} gap-3 items-center pb-1.5 mb-1 border-b border-ink/10 text-[10px] font-semibold uppercase tracking-wide text-sage/70`}>
      <div />
      <div />
      <div>Title</div>
      <div className="hidden md:block">Type</div>
      <div className="hidden md:block">Client</div>
      <div>Assigned</div>
      <div>Due</div>
      <div className="hidden md:block">Priority</div>
      <div>Notes</div>
      <div />
    </div>
  )
}

export default function TaskRow({
  t,
  clients,
  members,
  updateField,
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
  const [titleDraft, setTitleDraft] = useState(t.title)
  const [notesDraft, setNotesDraft] = useState(t.notes || '')
  // Resync local drafts when the underlying task changes from outside this row (save, realtime,
  // switching tasks) - adjusting state during render instead of an effect avoids an extra render.
  const [syncedFor, setSyncedFor] = useState(`${t.id}:${t.title}:${t.notes || ''}`)
  const syncKey = `${t.id}:${t.title}:${t.notes || ''}`
  if (syncKey !== syncedFor) {
    setSyncedFor(syncKey)
    setTitleDraft(t.title)
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
        className={`relative grid ${ROW_GRID_COLS} gap-3 items-center py-2 border-b border-ink/10 group ${isTimerRunning ? 'bg-green/5' : ''} ${isSubtask ? 'pl-6' : ''}`}
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

        {!t.done &&
          (isTimerRunning ? (
            <IconButton label="Pause timer" tone="green" icon={<PauseIcon />} onClick={stopTimer} className="!p-1" />
          ) : (
            <IconButton label="Start timer" tone="accent" icon={<PlayIcon />} onClick={startTimer} className="!p-1" />
          ))}

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
          <input
            className={`flex-1 min-w-0 text-sm ${PLAIN_FIELD} ${t.done ? 'line-through text-sage' : ''}`}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft.trim() && titleDraft !== t.title) updateField('title', titleDraft)
              else setTitleDraft(t.title)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setTitleDraft(t.title)
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
          {isTimerRunning && (
            <span className="text-xs font-mono text-green inline-flex items-center gap-1 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" /> {elapsed}
            </span>
          )}
        </div>

        <div className="hidden md:block text-xs text-sage truncate">{taskType}</div>

        <div className="hidden md:block text-xs">
          <CustomSelect
            variant="plain"
            value={t.client_id || ''}
            onChange={(v) => updateField('client_id', v)}
            options={[{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            className="text-sage"
          />
        </div>

        <div className="text-xs">
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

        <div className="flex items-center gap-1 text-xs">
          {isOverdue && <AlertTriangleIcon size={13} className="text-red-600 shrink-0" />}
          <DatePicker variant="plain" allowClear={false} value={t.due_date} onChange={(v) => updateField('due_date', v)} className={isOverdue ? 'text-red-600 font-medium' : 'text-sage'} />
        </div>

        <div className="hidden md:block text-xs">
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

        <input
          className={`w-full text-xs text-sage ${PLAIN_FIELD}`}
          value={notesDraft}
          placeholder="—"
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => {
            if (notesDraft !== (t.notes || '')) updateField('notes', notesDraft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />

        <div
          className={`flex gap-1.5 shrink-0 items-center justify-end transition-opacity ${
            isTimerRunning ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
        >
          {!t.done && !isTimerRunning && <QuickAddTime onAdd={addManualTime} />}
          {!t.done && <IconButton label="Snooze - push to tomorrow" tone="sage" icon={<MoonIcon />} onClick={snooze} />}
          {!t.done && skip && <IconButton label="Skip this occurrence" tone="accent" icon={<SkipForwardIcon />} onClick={skip} />}
          <IconButton label="Delete" tone="red" icon={<TrashIcon />} onClick={del} />
        </div>
      </motion.div>

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
