import { notFound } from 'next/navigation'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import ProjectDetailClient from './ProjectDetailClient'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, user, orgId, role } = await requireOrgContext()

  const { data: project } = await supabase.from('projects').select('*').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!project) notFound()

  const [{ data: phases }, { data: tasks }, { data: clients }, { data: members }, { data: budgets }] = await Promise.all([
    supabase.from('project_phases').select('*').eq('project_id', id).order('sort_order'),
    supabase.from('tasks').select('*').eq('project_id', id).eq('archived', false).order('sort_order'),
    supabase.from('clients').select('id, name').eq('org_id', orgId).order('name').limit(2000),
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url').eq('org_id', orgId).eq('status', 'active'),
    supabase.from('budgets').select('id, client_id, name').eq('org_id', orgId).eq('status', 'active').order('name'),
  ])

  return (
    <ProjectDetailClient
      orgId={orgId}
      userId={user.id}
      isAdmin={isAdminRole(role)}
      initialProject={project}
      initialPhases={phases ?? []}
      initialTasks={tasks ?? []}
      clients={clients ?? []}
      members={members ?? []}
      budgets={budgets ?? []}
    />
  )
}
