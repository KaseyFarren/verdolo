import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import OrgDetailClient from './OrgDetailClient'

export default async function AdminOrgDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params
  const admin = createAdminClient()

  const [{ data: org }, { data: members }] = await Promise.all([
    admin.from('orgs').select('*').eq('id', orgId).maybeSingle(),
    admin
      .from('org_members')
      .select('id, user_id, role, status, invited_email, joined_at, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
  ])

  if (!org) notFound()

  const activeMemberCount = (members ?? []).filter((m) => m.status === 'active').length

  return <OrgDetailClient org={org} members={members ?? []} activeMemberCount={activeMemberCount} />
}
