import { isAdminRole, requireOrgContext } from '@/lib/org'
import { getOrgAnthropicKey } from '@/lib/orgSecrets'
import IntegrationsClient from './IntegrationsClient'

export default async function IntegrationsPage() {
  const { orgId, role } = await requireOrgContext({ skipPaywall: true })
  const isAdmin = isAdminRole(role)
  const key = await getOrgAnthropicKey(orgId)
  // the key value itself is admin-only, but every role should see accurate connected status
  const apiKey = isAdmin ? key : null

  return <IntegrationsClient orgId={orgId} isAdmin={isAdmin} initialApiKey={apiKey ?? ''} hasKey={!!key} />
}
