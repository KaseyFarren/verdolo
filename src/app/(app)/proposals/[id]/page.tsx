import { notFound } from 'next/navigation'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import ProposalEditorClient from './ProposalEditorClient'

export default async function ProposalEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, orgId, role, org } = await requireOrgContext()

  const { data: proposal } = await supabase.from('proposals').select('*').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!proposal) notFound()

  const { data: client } = await supabase.from('clients').select('id, name').eq('id', proposal.client_id).maybeSingle()

  return (
    <ProposalEditorClient
      canEdit={isAdminRole(role)}
      initialProposal={proposal}
      clientName={client?.name ?? 'Unknown client'}
      currency={org?.settings?.currency ?? 'usd'}
    />
  )
}
