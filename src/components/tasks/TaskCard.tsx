'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Avatar from '@/components/ui/Avatar'
import { AlertTriangleIcon } from '@/components/ui/icons'
import { priorityColor, todayKey } from '@/lib/agency'
import type { Client, Member, Task } from '@/app/(app)/tasks/TasksClient'

export default function TaskCard({
  t,
  clients,
  members,
  onOpenDetail,
  subtaskCount,
  openSubtaskCount,
}: {
  t: Task
  clients: Client[]
  members: Member[]
  onOpenDetail: () => void
  subtaskCount: number
  openSubtaskCount: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  const assigneeIds = t.assignee_ids?.length ? t.assignee_ids : t.assigned_to ? [t.assigned_to] : []
  const clientName = clients.find((c) => c.id === t.client_id)?.name
  const isOverdue = !t.done && t.due_date < todayKey()

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onOpenDetail}
      className={`rounded-lg border border-ink/10 bg-white p-3 mb-2 cursor-pointer shadow-sm hover:shadow-md transition-shadow ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="text-sm mb-1.5">{t.title}</div>
      {clientName && <div className="text-xs text-sage truncate mb-1.5">{clientName}</div>}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[10px] font-medium ${priorityColor(t.priority)}`}>{t.priority}</span>
          {subtaskCount > 0 && (
            <span className="text-[10px] text-sage shrink-0">
              {subtaskCount - openSubtaskCount}/{subtaskCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isOverdue && <AlertTriangleIcon size={12} className="text-red-600" />}
          <span className={`text-[10px] ${isOverdue ? 'text-red-600 font-medium' : 'text-sage'}`}>{t.due_date}</span>
          {assigneeIds.length > 0 && (
            <span className="flex items-center -space-x-1.5">
              {assigneeIds.slice(0, 2).map((id) => (
                <Avatar key={id} member={members.find((m) => m.user_id === id)} size={18} className="ring-2 ring-white" />
              ))}
              {assigneeIds.length > 2 && <span className="text-[9px] text-sage ml-1">+{assigneeIds.length - 2}</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
