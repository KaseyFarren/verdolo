import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// org_members.invited_email is only a snapshot taken at invite time and is null for
// self-signup owners (create_org never sets it) - auth.users.email is the real source of
// truth for every member, invited or not (inviteUserByEmail creates the auth user up front).
export async function getUserEmailMap(admin: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data) break
    for (const u of data.users) if (u.email) map.set(u.id, u.email)
    if (data.users.length < 200) break
  }
  return map
}
