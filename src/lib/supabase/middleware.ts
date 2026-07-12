import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, generateNonce } from '@/lib/security/csp'

const PUBLIC_PATHS = ['/login', '/signup', '/auth', '/create-account', '/accept-invite']

export async function updateSession(request: NextRequest) {
  // Strip any client-supplied identity headers before we (maybe) set our own from the verified
  // session. Downstream Server Components trust x-user-id as the authenticated user, so an
  // inbound copy must never survive - this is the trust boundary for that shortcut.
  request.headers.delete('x-user-id')
  request.headers.delete('x-user-email')

  // Per-request CSP nonce. Setting Content-Security-Policy on the forwarded request headers
  // is how Next.js discovers the nonce and stamps it onto its own inline/bootstrap scripts;
  // x-nonce is exposed so Server Components can nonce any manual <script> they add later.
  const nonce = generateNonce()
  const csp = buildCsp(nonce)
  request.headers.set('x-nonce', nonce)
  request.headers.set('Content-Security-Policy', csp)

  let pendingCookies: { name: string; value: string; options?: CookieOptions }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          pendingCookies = cookiesToSet
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPublicPath = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    const redirect = NextResponse.redirect(url)
    redirect.headers.set('Content-Security-Policy', csp)
    return redirect
  }

  // Middleware already validated this session with Supabase's auth server (a real network
  // round trip) - pass the result down via headers so requireOrgContext() doesn't have to
  // pay for a second, redundant getUser() call on every page.
  if (user) {
    request.headers.set('x-user-id', user.id)
    request.headers.set('x-user-email', user.email ?? '')
  }

  const supabaseResponse = NextResponse.next({ request })
  supabaseResponse.headers.set('Content-Security-Policy', csp)
  pendingCookies.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))

  return supabaseResponse
}
