import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { buildGoogleAuthUrl } from '@/lib/googleAuth'

export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const state = randomBytes(16).toString('hex')
  const res = NextResponse.redirect(buildGoogleAuthUrl(origin, state))
  res.cookies.set('google_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
