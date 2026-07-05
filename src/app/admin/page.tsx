import { createAdminClient } from '@/lib/supabase/admin'
import AdminOrgsClient, { type AdminOrgRow } from './AdminOrgsClient'

export default async function AdminOrgsPage() {
  const admin = createAdminClient()

  const { data: orgs } = await admin
    .from('orgs')
    .select('id, name, subscription_status, seats_purchased, trial_ends_at, current_period_end, created_at, stripe_customer_id')
    .order('created_at', { ascending: false })

  const orgIds = (orgs ?? []).map((o) => o.id)
  const { data: members } = orgIds.length
    ? await admin.from('org_members').select('org_id, role, status, invited_email').in('org_id', orgIds)
    : { data: [] }

  const membersByOrg = new Map<string, typeof members>()
  for (const m of members ?? []) {
    const list = membersByOrg.get(m.org_id) ?? []
    list.push(m)
    membersByOrg.set(m.org_id, list)
  }

  const rows: AdminOrgRow[] = (orgs ?? []).map((org) => {
    const orgMembers = membersByOrg.get(org.id) ?? []
    const owner = orgMembers.find((m) => m.role === 'owner')
    const activeMemberCount = orgMembers.filter((m) => m.status === 'active').length
    return {
      id: org.id,
      name: org.name,
      ownerEmail: owner?.invited_email ?? null,
      subscriptionStatus: org.subscription_status,
      seatsPurchased: org.seats_purchased,
      activeMemberCount,
      trialEndsAt: org.trial_ends_at,
      currentPeriodEnd: org.current_period_end,
      createdAt: org.created_at,
    }
  })

  return <AdminOrgsClient orgs={rows} />
}
