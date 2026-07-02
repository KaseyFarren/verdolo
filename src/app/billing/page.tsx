import AppShell from '@/components/AppShell'
import { requireOrgContext } from '@/lib/org'
import BillingClient from './BillingClient'

export default async function BillingPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext({ skipPaywall: true })

  const { count: activeMemberCount } = await supabase
    .from('org_members')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'active')

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <BillingClient
        orgId={orgId}
        role={role}
        subscriptionStatus={org?.subscription_status ?? null}
        trialEndsAt={org?.trial_ends_at ?? null}
        seatsPurchased={org?.seats_purchased ?? 1}
        activeMemberCount={activeMemberCount ?? 0}
        hasStripeCustomer={!!org?.stripe_customer_id}
      />
    </AppShell>
  )
}
