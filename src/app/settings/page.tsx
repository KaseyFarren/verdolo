import AppShell from '@/components/AppShell'
import { isAdminRole, requireOrgContext } from '@/lib/org'
import { getAiCreditStatus } from '@/lib/aiCredits'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  // whole Settings section skips the paywall - an org with a lapsed subscription still
  // needs to reach every section here (not just get bounced straight to Billing) to fix it
  const { supabase, user, orgId, role, org } = await requireOrgContext({ skipPaywall: true })
  const isAdmin = isAdminRole(role)

  const [{ data: membership }, { count: activeMemberCount }, aiCredits] = await Promise.all([
    supabase.from('org_members').select('display_name').eq('org_id', orgId).eq('user_id', user.id).maybeSingle(),
    supabase.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'active'),
    getAiCreditStatus(orgId),
  ])

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <SettingsClient
        orgId={orgId}
        userId={user.id}
        role={role}
        isAdmin={isAdmin}
        settings={org?.settings ?? {}}
        initialAccentColor={org?.accent_color ?? '#dd6b2c'}
        initialDisplayName={membership?.display_name ?? ''}
        aiCredits={aiCredits}
        subscriptionStatus={org?.subscription_status ?? null}
        trialEndsAt={org?.trial_ends_at ?? null}
        seatsPurchased={org?.seats_purchased ?? 1}
        activeMemberCount={activeMemberCount ?? 0}
        hasStripeCustomer={!!org?.stripe_customer_id}
        planType={org?.plan_type ?? 'subscription'}
      />
    </AppShell>
  )
}
