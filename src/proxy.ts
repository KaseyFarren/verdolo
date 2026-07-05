import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Every route under /api authenticates itself (Supabase session cookie read directly via
  // supabase.auth.getUser() in user-facing routes, Stripe signature verification on webhooks,
  // CRON_SECRET on cron routes) — it doesn't depend on this proxy having run. Excluding /api
  // matters because Vercel Cron and Stripe's webhook POSTs never carry a Supabase session
  // cookie; without this exclusion the proxy redirected them to /login before the route's own
  // auth check could ever run, silently breaking cron jobs and webhook delivery in production.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
