import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Bypasses RLS via the secret key. Only import this from server routes/actions —
// `server-only` makes accidentally bundling it into client code a build error.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
