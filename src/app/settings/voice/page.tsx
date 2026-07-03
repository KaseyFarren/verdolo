import { isAdminRole, requireOrgContext } from '@/lib/org'
import VoiceClient from './VoiceClient'

export default async function SettingsVoicePage() {
  const { orgId, role, org } = await requireOrgContext({ skipPaywall: true })

  return <VoiceClient orgId={orgId} isAdmin={isAdminRole(role)} settings={org?.settings ?? {}} />
}
