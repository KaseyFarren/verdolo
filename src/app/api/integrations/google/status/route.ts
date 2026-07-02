import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ connected: false })

  const admin = createAdminClient()
  const { data } = await admin
    .from('integration_connections')
    .select('external_account_id')
    .eq('user_id', user.id)
    .eq('provider', 'gmail')
    .maybeSingle()

  return NextResponse.json({ connected: !!data, email: data?.external_account_id ?? null })
}
