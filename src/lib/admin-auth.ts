import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export function isAppOwnerEmail(email?: string | null) {
  if (!email) return false
  const allowlist = (process.env.APP_OWNER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return allowlist.includes(email.toLowerCase())
}

// For Server Components/layouts under /admin - proxy.ts passes x-user-id/x-user-email
// headers for page routes, so reuse them instead of a second auth round trip (same
// shortcut requireOrgContext uses in src/lib/org.ts).
export async function requireAppOwnerPage() {
  const headerList = await headers()
  const headerUserId = headerList.get('x-user-id')
  let user: { id: string; email?: string | null }
  if (headerUserId) {
    user = { id: headerUserId, email: headerList.get('x-user-email') }
  } else {
    const supabase = await createClient()
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser()
    if (!fetchedUser) redirect('/login')
    user = fetchedUser
  }
  if (!user) redirect('/login')
  // 404 rather than a redirect: a non-owner who guesses this URL shouldn't learn it exists.
  if (!isAppOwnerEmail(user.email)) notFound()
  return { user: { id: user.id, email: user.email ?? '' } }
}

// For Route Handlers under /api/admin - proxy.ts excludes /api entirely (so
// Stripe/cron webhook POSTs without a session cookie aren't redirected to /login),
// meaning there's no x-user-id header shortcut here; always calls getUser() directly.
export async function requireAppOwnerApi() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  if (!isAppOwnerEmail(user.email)) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  return { user: { id: user.id, email: user.email ?? '' } }
}
