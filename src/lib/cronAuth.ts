import 'server-only'

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations -
 * verify it so the endpoint can't be triggered by an outside request. */
export function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}
