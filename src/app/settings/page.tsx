import { isAdminRole, requireOrgContext } from '@/lib/org'
import GeneralClient from './GeneralClient'

export default async function SettingsGeneralPage() {
  const { orgId, role, org } = await requireOrgContext({ skipPaywall: true })

  return <GeneralClient orgId={orgId} isAdmin={isAdminRole(role)} settings={org?.settings ?? {}} />
}
