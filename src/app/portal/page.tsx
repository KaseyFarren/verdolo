import { requireClientContext } from '@/lib/client-portal'
import { createAdminClient } from '@/lib/supabase/admin'
import PortalHome, { type PortalPhase, type PortalProject, type PortalTask } from './PortalHome'


export default async function PortalPage({ searchParams }: { searchParams: Promise<{ digest?: string; task?: string }> }) {
  const { supabase, clientId, orgId, user, contactName, clientName } = await requireClientContext()
  const params = await searchParams

  // "Turn off morning emails" link in the digest lands here. Only touches the caller's own row
  // (client_users_update_own + guard trigger), so a forwarded link can't switch anyone else off.
  let digestJustOff = false
  if (params.digest === 'off') {
    await supabase.from('client_users').update({ daily_digest: false }).eq('user_id', user.id)
    digestJustOff = true
  }

  const [{ data: projects }, { data: tasks }, { data: me }] = await Promise.all([
    supabase.from('projects').select('id, name, description, status, due_date').eq('client_id', clientId).neq('status', 'archived').order('created_at', { ascending: true }),
    // portal_tasks() (0096): only portal-visible tasks, and notes only on the client's own requests.
    supabase.rpc('portal_tasks'),
    supabase.from('client_users').select('daily_digest').eq('user_id', user.id).maybeSingle(),
  ])
  const projectIds = (projects ?? []).map((p) => p.id)
  const { data: phases } = projectIds.length
    ? await supabase.from('project_phases').select('id, name, sort_order, project_id').in('project_id', projectIds)
    : { data: [] }

  // Who the client works with, by first name ("Ask Kasey for something"). Clients can't read
  // org_members, so this one lookup uses the service role and returns only a display name.
  const admin = createAdminClient()
  const { data: client } = await admin.from('clients').select('primary_contact_id').eq('id', clientId).maybeSingle()
  const { data: members } = await admin.from('org_members').select('user_id, display_name, role').eq('org_id', orgId).eq('status', 'active')
  const lead =
    (members ?? []).find((m) => m.user_id === client?.primary_contact_id) ?? (members ?? []).find((m) => m.role === 'owner') ?? (members ?? [])[0]
  const teamName = lead?.display_name?.trim().split(' ')[0] || 'your team'

  return (
    <PortalHome
      orgId={orgId}
      userId={user.id}
      clientName={clientName}
      contactName={contactName}
      teamName={teamName}
      projects={(projects ?? []) as PortalProject[]}
      phases={(phases ?? []) as PortalPhase[]}
      tasks={((tasks ?? []) as (PortalTask & { skipped: boolean })[]).filter((t) => !t.skipped)}
      dailyDigest={me?.daily_digest ?? true}
      digestJustOff={digestJustOff}
      openTaskId={params.task ?? null}
    />
  )
}
