import { isAdminRole, requireOrgContext } from '@/lib/org'
import ProposalsClient from './ProposalsClient'

export default async function ProposalsPage() {
  const { supabase, orgId, role, org } = await requireOrgContext()
  const canEdit = isAdminRole(role)

  const [{ data: proposals }, { data: clients }] = await Promise.all([
    supabase.from('proposals').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
    supabase.from('clients').select('id, name').eq('org_id', orgId).order('name'),
  ])

  return (
    <ProposalsClient
      orgId={orgId}
      canEdit={canEdit}
      initialProposals={proposals ?? []}
      clients={clients ?? []}
      currency={org?.settings?.currency ?? 'usd'}
    />
  )
}
