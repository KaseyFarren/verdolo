import { isAdminRole, requireOrgContext } from '@/lib/org'
import DataClient from './DataClient'

export default async function DataPage() {
  const { orgId, role } = await requireOrgContext({ skipPaywall: true })

  return <DataClient orgId={orgId} isAdmin={isAdminRole(role)} />
}
