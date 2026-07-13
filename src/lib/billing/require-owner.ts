import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type OwnerAuth = { user: { id: string }; admin: ReturnType<typeof createAdminClient> }
type AuthError = { error: string; status: number }

export async function requireOrgOwner(orgId: string): Promise<OwnerAuth | AuthError> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', status: 401 }

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (membership?.role !== 'owner') {
    return { error: 'Only the org owner can manage billing', status: 403 }
  }

  return { user, admin: createAdminClient() }
}

export function isAuthError(result: OwnerAuth | AuthError): result is AuthError {
  return 'error' in result
}
