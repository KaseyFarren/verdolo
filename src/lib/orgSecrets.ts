import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/** Members (not just admins) can trigger AI generation, but only admins can read/edit
 * the raw key in Settings — so this reads it with the admin client after the caller's
 * own membership has already been checked with the normal RLS-scoped client. */
export async function getOrgAnthropicKey(orgId: string) {
  const admin = createAdminClient()
  const { data } = await admin.from('org_secrets').select('anthropic_api_key').eq('org_id', orgId).maybeSingle()
  return data?.anthropic_api_key || null
}
