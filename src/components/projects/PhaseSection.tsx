'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import IconButton from '@/components/ui/IconButton'
import { ChevronDownIcon, PlusIcon, TrashIcon } from '@/components/ui/icons'

// One phase, rendered as a vertical section that grows with its task count - not a Kanban
// column. Sections stack top to bottom; drag a task in from another section, or use the "+ Add
// task" row at the bottom. Renaming is inline (click the title), everything else lives behind
// the "⋯" menu so the header stays quiet when there's nothing to do.
export default function PhaseSection({
  phase,
  taskIds,
  doneCount,
  totalCount,
  canMoveUp,
  canMoveDown,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
  isAddingTask,
  onStartAddTask,
  addTaskForm,
  children,
}: {
  phase: { id: string; name: string }
  taskIds: string[]
  doneCount: number
  totalCount: number
  canMoveUp: boolean
  canMoveDown: boolean
  onRename: (name: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  isAddingTask: boolean
  onStartAddTask: () => void
  addTaskForm: ReactNode
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `phase:${phase.id}` })
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(phase.name)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  function commitRename() {
    setRenaming(false)
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== phase.name) onRename(trimmed)
    else setNameDraft(phase.name)
  }

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1.5">
        {renaming ? (
          <input
            autoFocus
            className="text-sm font-semibold bg-white border border-ink/15 rounded px-2 py-0.5"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setNameDraft(phase.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <button type="button" className="text-sm font-semibold hover:underline text-left" onClick={() => setRenaming(true)}>
            {phase.name}
          </button>
        )}
        <span className="text-xs text-sage">
          {doneCount}/{totalCount}
        </span>
        <div className="flex-1" />
        <div className="relative" ref={menuRef}>
          <IconButton label="Phase options" icon={<ChevronDownIcon size={14} />} onClick={() => setMenuOpen((v) => !v)} />
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg bg-white shadow-lg border border-ink/10 py-1">
                <button
                  type="button"
                  disabled={!canMoveUp}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-sand disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => {
                    onMoveUp()
                    setMenuOpen(false)
                  }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  disabled={!canMoveDown}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-sand disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => {
                    onMoveDown()
                    setMenuOpen(false)
                  }}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-600/10"
                  onClick={() => {
                    onDelete()
                    setMenuOpen(false)
                  }}
                >
                  <TrashIcon size={13} /> Delete phase
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div ref={setNodeRef} className={`rounded-lg transition-colors ${isOver ? 'bg-accent/5 ring-1 ring-accent/20' : ''} min-h-[44px]`}>
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
        {totalCount === 0 && !isAddingTask && <div className="text-xs text-sage/60 py-2">No tasks in this phase yet</div>}
        {isAddingTask ? (
          addTaskForm
        ) : (
          <button type="button" onClick={onStartAddTask} className="text-xs text-sage hover:text-ink py-1.5 flex items-center gap-1">
            <PlusIcon size={11} /> Add task
          </button>
        )}
      </div>
    </div>
  )
}
