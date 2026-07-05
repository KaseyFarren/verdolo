import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

const TIERS = [
  { maxSeats: 3, name: 'Starter', limit: 100 },
  { maxSeats: 10, name: 'Growth', limit: 300 },
  { maxSeats: Infinity, name: 'Scale', limit: 500 },
] as const

function tierForSeatCount(seatCount: number) {
  return TIERS.find((t) => seatCount <= t.maxSeats) ?? TIERS[TIERS.length - 1]
}

async function activeSeatCount(orgId: string) {
  const admin = createAdminClient()
  const { count } = await admin.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'active')
  return count || 1
}

// A credit period resets on the calendar month, not on a rolling 30-day window.
function periodHasElapsed(resetAt: string) {
  const reset = new Date(resetAt)
  const now = new Date()
  return reset.getUTCFullYear() !== now.getUTCFullYear() || reset.getUTCMonth() !== now.getUTCMonth()
}

/** Read-only status for display (Settings) — never writes, so a page view can't itself reset the counter. */
export async function getAiCreditStatus(orgId: string) {
  const admin = createAdminClient()
  const [{ data: org }, seatCount] = await Promise.all([
    admin.from('orgs').select('ai_credits_used, ai_credits_reset_at').eq('id', orgId).single(),
    activeSeatCount(orgId),
  ])
  const tier = tierForSeatCount(seatCount)
  const used = org && !periodHasElapsed(org.ai_credits_reset_at) ? org.ai_credits_used : 0
  return { tierName: tier.name, limit: tier.limit, used, remaining: Math.max(0, tier.limit - used) }
}

/** Call before every AI generation. Consumes one credit and returns whether the org is under its monthly limit. */
export async function checkAndConsumeAiCredit(orgId: string): Promise<{ allowed: boolean; tierName: string; limit: number; used: number }> {
  const admin = createAdminClient()
  const [{ data: org }, seatCount] = await Promise.all([
    admin.from('orgs').select('ai_credits_used, ai_credits_reset_at').eq('id', orgId).single(),
    activeSeatCount(orgId),
  ])
  const tier = tierForSeatCount(seatCount)
  const resetting = !org || periodHasElapsed(org.ai_credits_reset_at)
  const used = resetting ? 0 : org.ai_credits_used

  if (used >= tier.limit) {
    return { allowed: false, tierName: tier.name, limit: tier.limit, used }
  }

  await admin
    .from('orgs')
    .update({ ai_credits_used: used + 1, ai_credits_reset_at: resetting ? new Date().toISOString() : org!.ai_credits_reset_at })
    .eq('id', orgId)

  return { allowed: true, tierName: tier.name, limit: tier.limit, used: used + 1 }
}
