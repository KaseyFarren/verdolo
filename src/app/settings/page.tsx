import AppShell from '@/components/AppShell'
import { requireOrgContext } from '@/lib/org'
import { getOrgAnthropicKey } from '@/lib/orgSecrets'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const { user, orgId, role, org } = await requireOrgContext()
  const apiKey = role === 'admin' ? await getOrgAnthropicKey(orgId) : null

  return (
    <AppShell orgName={org?.name ?? ''} userEmail={user.email ?? ''}>
      <SettingsClient orgId={orgId} role={role} settings={org?.settings ?? {}} initialApiKey={apiKey ?? ''} />
    </AppShell>
  )
}
