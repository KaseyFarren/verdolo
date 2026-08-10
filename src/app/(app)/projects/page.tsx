import { requireOrgContext } from '@/lib/org'
import ProjectsClient from './ProjectsClient'

export default async function ProjectsPage() {
  const { supabase, user, orgId } = await requireOrgContext()

  const [{ data: projects }, { data: clients }, { data: budgets }, { data: taskCounts }] = await Promise.all([
    supabase.from('projects').select('*').eq('org_id', orgId).order('sort_order').order('created_at', { ascending: false }),
    supabase.from('clients').select('id, name').eq('org_id', orgId).order('name').limit(2000),
    supabase.from('budgets').select('id, client_id, name').eq('org_id', orgId).eq('status', 'active').order('name'),
    // Lightweight slice just to compute a done/total progress figure per project on the list -
    // the project detail page fetches the full task rows itself.
    supabase.from('tasks').select('id, project_id, done').eq('org_id', orgId).eq('archived', false).not('project_id', 'is', null),
  ])

  return (
    <ProjectsClient
      orgId={orgId}
      userId={user.id}
      initialProjects={projects ?? []}
      clients={clients ?? []}
      budgets={budgets ?? []}
      taskCounts={taskCounts ?? []}
    />
  )
}
