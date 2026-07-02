import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeCodeForTokens, fetchGoogleEmail } from '@/lib/googleAuth'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const cookieStore = await cookies()
  const cookieState = cookieStore.get('google_oauth_state')?.value

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(`${origin}/settings?gmail=error`)
  }

  const { data: membership } = await supabase.from('org_members').select('org_id').eq('user_id', user.id).eq('status', 'active').maybeSingle()
  if (!membership) return NextResponse.redirect(`${origin}/onboarding`)

  try {
    const tokens = await exchangeCodeForTokens(origin, code)
    const email = await fetchGoogleEmail(tokens.access_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const admin = createAdminClient()
    await admin.from('integration_connections').upsert(
      {
        org_id: membership.org_id,
        user_id: user.id,
        provider: 'gmail',
        access_token_encrypted: tokens.access_token,
        refresh_token_encrypted: tokens.refresh_token,
        expires_at: expiresAt,
        scope: 'gmail.readonly gmail.send',
        external_account_id: email,
      },
      { onConflict: 'org_id,user_id,provider' }
    )

    const res = NextResponse.redirect(`${origin}/settings?gmail=connected`)
    res.cookies.delete('google_oauth_state')
    return res
  } catch {
    return NextResponse.redirect(`${origin}/settings?gmail=error`)
  }
}
