import { requireOrgContext } from '@/lib/org'
import ProfileClient from './ProfileClient'

export default async function ProfilePage() {
  const { supabase, user, orgId } = await requireOrgContext({ skipPaywall: true })
  const { data: membership } = await supabase
    .from('org_members')
    .select('display_name')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  return <ProfileClient orgId={orgId} userId={user.id} initialDisplayName={membership?.display_name ?? ''} />
}
