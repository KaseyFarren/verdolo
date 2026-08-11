import { cache } from 'react'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export type Role = 'owner' | 'admin' | 'member'

export function isAdminRole(role: Role) {
  return role === 'owner' || role === 'admin'
}

// Personal super-admin gate for dev/testing affordances that shouldn't ship to real users (e.g.
// the "Test onboarding" reset button). Defaults to the founder's account; override via env.
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'kasey@kaseyfarren.com'
export function isSuperAdmin(email?: string | null) {
  return !!email && email.toLowerCase() === SUPERADMIN_EMAIL.toLowerCase()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasActiveAccess(org: any) {
  if (org.subscription_status === 'active' || org.subscription_status === 'past_due') return true
  if (org.subscription_status === 'trialing') return !org.trial_ends_at || new Date(org.trial_ends_at) > new Date()
  return false
}

// Wrapped in React's cache() so the (app) layout and a page can both call this within the
// same request/navigation without paying for the org_members query twice - the layout needs
// it to render AppShell's chrome, and the page needs it again for its own data fetching.
export const getOrgContext = cache(async () => {
  const supabase = await createClient()

  // Middleware already validated the session with a real network round trip and passed the
  // result via headers - reuse it instead of paying for a second auth.getUser() round trip.
  // Falls back to calling it directly if the request somehow bypassed middleware.
  const headerList = await headers()
  const headerUserId = headerList.get('x-user-id')
  const user = headerUserId
    ? { id: headerUserId, email: headerList.get('x-user-email') || undefined }
    : await (async () => {
        const {
          data: { user: fetchedUser },
        } = await supabase.auth.getUser()
        return fetchedUser
      })()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, role, orgs(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) {
    const { data: clientMembership } = await supabase
      .from('client_users')
      .select('client_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
    redirect(clientMembership ? '/portal' : '/onboarding')
  }

  return {
    supabase,
    user,
    orgId: membership.org_id as string,
    role: membership.role as Role,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    org: membership.orgs as any,
  }
})

export async function requireOrgContext(opts?: { skipPaywall?: boolean }) {
  const ctx = await getOrgContext()
  if (!opts?.skipPaywall && !hasActiveAccess(ctx.org)) redirect('/settings?view=billing')
  return ctx
}
