import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/auth', '/create-account', '/accept-invite']

export async function updateSession(request: NextRequest) {
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
    return NextResponse.redirect(url)
  }

  // Middleware already validated this session with Supabase's auth server (a real network
  // round trip) - pass the result down via headers so requireOrgContext() doesn't have to
  // pay for a second, redundant getUser() call on every page.
  if (user) {
    request.headers.set('x-user-id', user.id)
    request.headers.set('x-user-email', user.email ?? '')
  }

  const supabaseResponse = NextResponse.next({ request })
  pendingCookies.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))

  return supabaseResponse
}
