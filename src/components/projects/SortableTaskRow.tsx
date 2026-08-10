'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon } from '@/components/ui/icons'
import TaskRow from '@/components/tasks/TaskRow'
import type { ComponentProps } from 'react'

// Thin useSortable wrapper around the shared TaskRow. The grip handle owns the drag listeners
// (not the row) - TaskRow is full of CustomSelect/MultiSelect/DatePicker triggers that would
// otherwise fight a whole-row PointerSensor for every click.
export default function SortableTaskRow(props: ComponentProps<typeof TaskRow>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.t.id })

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-start gap-1 ${isDragging ? 'opacity-40' : ''}`}>
      <button type="button" {...attributes} {...listeners} className="mt-2.5 shrink-0 text-sage/40 hover:text-sage cursor-grab active:cursor-grabbing touch-none" aria-label="Drag to reorder or move phase">
        <GripVerticalIcon size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <TaskRow {...props} />
      </div>
    </div>
  )
}
