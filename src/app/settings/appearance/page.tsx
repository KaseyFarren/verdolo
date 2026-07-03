import { isAdminRole, requireOrgContext } from '@/lib/org'
import AppearanceClient from './AppearanceClient'

export default async function AppearancePage() {
  const { orgId, role, org } = await requireOrgContext({ skipPaywall: true })

  return <AppearanceClient orgId={orgId} isAdmin={isAdminRole(role)} initialAccentColor={org?.accent_color ?? '#dd6b2c'} />
}
