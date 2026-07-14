import { createAdminClient } from '@/lib/supabase/admin'
import { getUserEmailMap } from '@/lib/adminUsers'
import AdminOrgsClient, { type AdminOrgRow, type OrphanedUser } from './AdminOrgsClient'

export default async function AdminOrgsPage() {
  const admin = createAdminClient()

  const [{ data: orgs }, emailMap] = await Promise.all([
    admin
      .from('orgs')
      .select('id, name, subscription_status, plan_type, seats_purchased, trial_ends_at, current_period_end, created_at, stripe_customer_id')
      .order('created_at', { ascending: false }),
    getUserEmailMap(admin),
  ])

  const orgIds = (orgs ?? []).map((o) => o.id)
  const { data: members } = orgIds.length
    ? await admin.from('org_members').select('org_id, user_id, role, status').in('org_id', orgIds)
    : { data: [] }

  const membersByOrg = new Map<string, typeof members>()
  const memberUserIds = new Set<string>()
  for (const m of members ?? []) {
    const list = membersByOrg.get(m.org_id) ?? []
    list.push(m)
    membersByOrg.set(m.org_id, list)
    memberUserIds.add(m.user_id)
  }

  const rows: AdminOrgRow[] = (orgs ?? []).map((org) => {
    const orgMembers = membersByOrg.get(org.id) ?? []
    const owner = orgMembers.find((m) => m.role === 'owner')
    const activeMemberCount = orgMembers.filter((m) => m.status === 'active').length
    return {
      id: org.id,
      name: org.name,
      ownerEmail: (owner && emailMap.get(owner.user_id)) ?? null,
      subscriptionStatus: org.subscription_status,
      planType: org.plan_type,
      seatsPurchased: org.seats_purchased,
      activeMemberCount,
      trialEndsAt: org.trial_ends_at,
      currentPeriodEnd: org.current_period_end,
      createdAt: org.created_at,
    }
  })

  // Auth users with no org_members row at all - abandoned signups (started account creation,
  // never finished org setup). They block re-signup with the same email and aren't reachable
  // from any other admin view, so surface them here for manual cleanup.
  const orphanedUsers: OrphanedUser[] = Array.from(emailMap.entries())
    .filter(([id]) => !memberUserIds.has(id))
    .map(([id, email]) => ({ id, email }))

  return <AdminOrgsClient orgs={rows} orphanedUsers={orphanedUsers} />
}
