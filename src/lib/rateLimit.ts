import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Fixed-window rate limit backed by the `rate_limits` table (see migration 0050). Works across
 * serverless instances because the counter lives in Postgres and is incremented atomically.
 * Fails OPEN (returns allowed) if the check itself errors - a limiter outage shouldn't take
 * down the feature it's protecting.
 */
export async function rateLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('check_rate_limit', {
    p_bucket: bucket,
    p_max: max,
    p_window_seconds: windowSeconds,
  })
  if (error) return true
  return data === true
}

/** Best-effort client IP for unauthenticated buckets (Vercel sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  return fwd?.split(',')[0]?.trim() || 'unknown'
}
