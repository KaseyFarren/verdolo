import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import InviteForm from './invite-form'
import MembersList from './MembersList'

export default async function TeamPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  if (!isAdminRole(role)) redirect('/dashboard')

  const { data: members } = await supabase
    .from('org_members')
    .select('id, user_id, role, title, status, invited_email, display_name, avatar_url, joined_at')
    .eq('org_id', orgId)
    .order('joined_at', { ascending: true })

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-sage">{org?.name} · signed in as {user.email} ({role})</p>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-sage">Members</h2>
        <MembersList members={members ?? []} currentUserId={user.id} canManage={isAdminRole(role)} canManageOwners={role === 'owner'} />
      </section>

      <InviteForm orgId={orgId} canInviteOwner={role === 'owner'} />
    </AppShell>
  )
}
