import { cache } from 'react'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

// Mirrors getOrgContext() in org.ts, but for the client-portal side: a client_users row scopes
// the caller to exactly one client (and that client's org), not to org-wide access.
export const getClientContext = cache(async () => {
  const supabase = await createClient()

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
    .from('client_users')
    .select('org_id, client_id, clients(name)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) {
    // Not a client user - if they're a real team member they belong on the app side, otherwise
    // they're mid-onboarding with neither kind of membership yet.
    const { data: orgMembership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
    redirect(orgMembership ? '/dashboard' : '/onboarding')
  }

  return {
    supabase,
    user,
    orgId: membership.org_id as string,
    clientId: membership.client_id as string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientName: (membership.clients as any)?.name as string,
  }
})
