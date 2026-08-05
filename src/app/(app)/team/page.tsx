import { redirect } from 'next/navigation'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import InviteForm from './invite-form'
import MembersList from './MembersList'

export default async function TeamPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  if (!isAdminRole(role)) redirect('/dashboard')

  const { data: members } = await supabase
    .from('org_members')
    .select('id, user_id, role, title, target_hours_per_week, status, invited_email, display_name, avatar_url, joined_at')
    .eq('org_id', orgId)
    .order('joined_at', { ascending: true })

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-sage">{org?.name} · signed in as {user.email} ({role})</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <section>
          <h2 className="mb-2 text-sm font-medium text-sage uppercase tracking-wide">Members</h2>
          <MembersList orgId={orgId} members={members ?? []} currentUserId={user.id} canManage={isAdminRole(role)} canManageOwners={role === 'owner'} />
        </section>

        <div>
          {(members?.length ?? 0) === 1 && (
            <p className="mb-2 text-sm text-sage">You&apos;re the only one here so far - invite a teammate to start collaborating.</p>
          )}
          <InviteForm orgId={orgId} canInviteOwner={role === 'owner'} />
        </div>
      </div>
    </>
  )
}
