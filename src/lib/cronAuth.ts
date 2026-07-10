import 'server-only'
import { timingSafeEqual } from 'crypto'

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations -
 * verify it so the endpoint can't be triggered by an outside request. Uses a constant-time
 * comparison so the check can't be probed byte-by-byte via response timing. */
export function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const a = Buffer.from(request.headers.get('authorization') ?? '')
  const b = Buffer.from(`Bearer ${secret}`)
  // timingSafeEqual throws on length mismatch, so guard length first (length isn't secret).
  return a.length === b.length && timingSafeEqual(a, b)
}
