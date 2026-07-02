import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import { getOrgAnthropicKey } from '@/lib/orgSecrets'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()
  const apiKey = isAdminRole(role) ? await getOrgAnthropicKey(orgId) : null
  const { data: membership } = await supabase
    .from('org_members')
    .select('display_name, avatar_url')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  return (
    <AppShell orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role}>
      <SettingsClient
        orgId={orgId}
        userId={user.id}
        role={role}
        settings={org?.settings ?? {}}
        initialApiKey={apiKey ?? ''}
        initialDisplayName={membership?.display_name ?? ''}
        initialAvatarUrl={membership?.avatar_url ?? ''}
        subscriptionStatus={org?.subscription_status ?? null}
        trialEndsAt={org?.trial_ends_at ?? null}
      />
    </AppShell>
  )
}
