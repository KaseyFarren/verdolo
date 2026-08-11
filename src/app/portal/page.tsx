import { requireClientContext } from '@/lib/client-portal'
import { formatDate } from '@/lib/agency'

type PortalTask = { id: string; title: string; done: boolean; due_date: string | null; phase_id: string | null }
type PortalPhase = { id: string; name: string; sort_order: number }
type PortalProject = { id: string; name: string; description: string | null; status: string; due_date: string | null }

const STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' }

export default async function PortalPage() {
  const { supabase, clientId } = await requireClientContext()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, description, status, due_date')
    .eq('client_id', clientId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })

  const projectIds = (projects ?? []).map((p) => p.id)

  const [{ data: phases }, { data: tasks }] = await Promise.all([
    projectIds.length
      ? supabase.from('project_phases').select('id, name, sort_order, project_id').in('project_id', projectIds)
      : Promise.resolve({ data: [] as (PortalPhase & { project_id: string })[] }),
    projectIds.length
      ? supabase.from('tasks').select('id, title, done, due_date, phase_id, project_id').in('project_id', projectIds).is('parent_task_id', null).eq('skipped', false)
      : Promise.resolve({ data: [] as (PortalTask & { project_id: string })[] }),
  ])

  if (!projects || projects.length === 0) {
    return <p className="text-sm text-sage">No active projects yet. Check back once your team gets one started.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      {(projects as PortalProject[]).map((project) => {
        const projectPhases = (phases ?? []).filter((ph) => (ph as PortalPhase & { project_id: string }).project_id === project.id).sort((a, b) => a.sort_order - b.sort_order)
        const projectTasks = (tasks ?? []).filter((t) => (t as PortalTask & { project_id: string }).project_id === project.id) as PortalTask[]
        const unphased = projectTasks.filter((t) => !t.phase_id)
        const done = projectTasks.filter((t) => t.done).length

        return (
          <div key={project.id} className="rounded-2xl bg-white border border-ink/8 p-5">
            <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
              <h2 className="text-lg font-semibold">{project.name}</h2>
              <span className="text-xs text-sage px-2 py-1 rounded-full bg-sand">{STATUS_LABEL[project.status] ?? project.status}</span>
            </div>
            <div className="text-xs text-sage mb-3 flex items-center gap-2 flex-wrap">
              {project.due_date && <span>Due {formatDate(project.due_date)}</span>}
              {projectTasks.length > 0 && (
                <span>
                  {done}/{projectTasks.length} tasks done
                </span>
              )}
            </div>
            {project.description && <p className="text-sm text-sage mb-4 whitespace-pre-wrap">{project.description}</p>}

            <div className="flex flex-col gap-4">
              {projectPhases.map((phase) => (
                <TaskGroup key={phase.id} title={phase.name} tasks={projectTasks.filter((t) => t.phase_id === phase.id)} />
              ))}
              {unphased.length > 0 && <TaskGroup title={projectPhases.length ? 'Other' : 'Tasks'} tasks={unphased} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TaskGroup({ title, tasks }: { title: string; tasks: PortalTask[] }) {
  if (tasks.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold text-sage uppercase tracking-wide mb-1.5">{title}</h3>
      <ul className="flex flex-col gap-1">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-2 text-sm py-1">
            <span className={`inline-block w-3.5 h-3.5 rounded-full border shrink-0 ${t.done ? 'bg-accent border-accent' : 'border-ink/25'}`} />
            <span className={t.done ? 'line-through text-sage' : ''}>{t.title}</span>
            {t.due_date && !t.done && <span className="text-xs text-sage ml-auto shrink-0">{formatDate(t.due_date)}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
