'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import ProjectFormModal, { type ProjectFormValues } from '@/components/projects/ProjectFormModal'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import CustomSelect, { type SelectGroup, type SelectOption } from '@/components/ui/CustomSelect'
import IconButton from '@/components/ui/IconButton'
import { FolderIcon, PencilIcon, PlusIcon, TrashIcon } from '@/components/ui/icons'
import { formatDate } from '@/lib/agency'

export type ProjectRow = {
  id: string
  client_id: string | null
  budget_id: string | null
  name: string
  description: string | null
  status: string
  start_date: string | null
  due_date: string | null
  sort_order: number
  created_at: string
}
type Client = { id: string; name: string }
type Budget = { id: string; client_id: string; name: string }
type TaskCount = { id: string; project_id: string | null; done: boolean }

const STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' }
const STATUS_COLOR: Record<string, string> = { active: '#2db87a', on_hold: '#cc9a3c', completed: '#5d6b5c', archived: '#8a8a8a' }

export default function ProjectsClient({
  orgId,
  initialProjects,
  clients,
  budgets,
  taskCounts,
}: {
  orgId: string
  userId: string
  initialProjects: ProjectRow[]
  clients: Client[]
  budgets: Budget[]
  taskCounts: TaskCount[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const confirm = useConfirm()
  const [projects, setProjects] = useState(initialProjects)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ProjectRow | null>(null)

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name || ''

  const progressByProject = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>()
    for (const t of taskCounts) {
      if (!t.project_id) continue
      const entry = map.get(t.project_id) || { done: 0, total: 0 }
      entry.total += 1
      if (t.done) entry.done += 1
      map.set(t.project_id, entry)
    }
    return map
  }, [taskCounts])

  const filterOptions: SelectOption[] = [
    { value: 'all', label: 'All statuses' },
    { value: 'active', label: 'Active' },
    { value: 'on_hold', label: 'On hold' },
    { value: 'completed', label: 'Completed' },
    { value: 'archived', label: 'Archived' },
  ]
  const filterGroups: SelectGroup[] =
    clients.length > 0
      ? [
          {
            label: 'Clients',
            options: clients.map((c) => ({ value: `client:${c.id}`, label: c.name })),
          },
        ]
      : []

  const visible = projects.filter((p) => {
    if (filter.startsWith('client:')) {
      if (p.client_id !== filter.slice('client:'.length)) return false
    } else if (filter !== 'all' && p.status !== filter) {
      return false
    }
    if (search.trim() && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  })

  async function createProject(values: ProjectFormValues, phaseNames: string[]) {
    const { data: project, error } = await supabase.from('projects').insert({ org_id: orgId, ...values }).select().single()
    if (error || !project) {
      toast.error('Could not create project')
      return
    }
    const names = phaseNames.filter((n) => n.trim())
    if (names.length) {
      const { error: phaseError } = await supabase.from('project_phases').insert(
        names.map((name, i) => ({ org_id: orgId, project_id: project.id, name, sort_order: i })),
      )
      if (phaseError) toast.error('Project created, but phases failed to save')
    }
    setShowForm(false)
    router.push(`/projects/${project.id}`)
  }

  async function saveEdit(values: ProjectFormValues) {
    if (!editing) return
    const { data, error } = await supabase.from('projects').update(values).eq('id', editing.id).select().single()
    if (error || !data) {
      toast.error('Could not save project')
      return
    }
    setProjects((prev) => prev.map((p) => (p.id === editing.id ? (data as ProjectRow) : p)))
    setEditing(null)
  }

  async function deleteProject(p: ProjectRow) {
    const ok = await confirm({ title: 'Delete project', message: `Delete "${p.name}"? Its phases go with it, but tasks stay - they just lose their project.`, danger: true })
    if (!ok) return
    const { error } = await supabase.from('projects').delete().eq('id', p.id)
    if (error) {
      toast.error('Could not delete project')
      return
    }
    setProjects((prev) => prev.filter((x) => x.id !== p.id))
    toast.success('Project deleted')
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Button variant="primary" size="sm" data-tour="new-project-button" onClick={() => setShowForm(true)}>
          <PlusIcon size={14} className="inline -mt-0.5 mr-1" /> New project
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          className="flex-1 min-w-[160px] rounded-full border border-ink/10 bg-white px-3 py-1.5 text-sm"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <CustomSelect value={filter} onChange={setFilter} options={filterOptions} groups={filterGroups} className="w-40" />
      </div>

      {visible.length === 0 && (
        <Card className="text-center py-10 text-sage">
          <FolderIcon size={28} className="mx-auto mb-2 opacity-50" />
          {projects.length === 0 ? 'No projects yet - create one to organize work into phases.' : 'No projects match this filter.'}
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {visible.map((p) => {
          const progress = progressByProject.get(p.id)
          const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
          return (
            <Card key={p.id} className="!p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{p.name}</span>
                    <span className="text-[10px] font-semibold shrink-0 rounded-full px-1.5 py-0.5" style={{ color: STATUS_COLOR[p.status], background: `${STATUS_COLOR[p.status]}18` }}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  <div className="text-xs text-sage mt-0.5 flex items-center gap-2 flex-wrap">
                    {p.client_id && <span>{clientName(p.client_id)}</span>}
                    {p.due_date && <span>Due {formatDate(p.due_date)}</span>}
                    {progress && progress.total > 0 && (
                      <span>
                        {progress.done}/{progress.total} tasks
                      </span>
                    )}
                  </div>
                </div>
                {progress && progress.total > 0 && (
                  <div className="hidden sm:block w-28 h-1.5 rounded-full bg-sand shrink-0">
                    <div className="h-1.5 rounded-full bg-green" style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <IconButton label="Edit" icon={<PencilIcon size={13} />} onClick={() => setEditing(p)} />
                  <IconButton label="Delete" tone="red" icon={<TrashIcon size={13} />} onClick={() => deleteProject(p)} />
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {showForm && <ProjectFormModal clients={clients} budgets={budgets} onSave={createProject} onClose={() => setShowForm(false)} />}
      {editing && (
        <ProjectFormModal
          initial={editing}
          clients={clients}
          budgets={budgets}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
