import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export type Role = 'owner' | 'admin' | 'member'

export function isAdminRole(role: Role) {
  return role === 'owner' || role === 'admin'
}

export async function requireOrgContext() {
  const supabase = await createClient()

  // Middleware already validated the session with a real network round trip and passed the
  // result via headers — reuse it instead of paying for a second auth.getUser() round trip.
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

  if (!membership) redirect('/onboarding')

  return {
    supabase,
    user,
    orgId: membership.org_id as string,
    role: membership.role as Role,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    org: membership.orgs as any,
  }
}
