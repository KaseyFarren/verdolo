import 'server-only'

/**
 * Thin wrapper over Resend's HTTP API. Best-effort by convention - callers should catch and log
 * rather than let a failed/misconfigured send fail the request it's attached to (see bug-report
 * and client-message-alert routes).
 */
export async function sendEmail({
  to,
  subject,
  text,
  html,
  from,
  replyTo,
}: {
  to: string | string[]
  subject: string
  text?: string
  html?: string
  from?: string
  /** Where replies go - a real inbox (the person behind the email), never a no-reply. */
  replyTo?: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[email] RESEND_API_KEY not configured - skipping send')
    return false
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from || process.env.RESEND_FROM_EMAIL || 'Verdolo <notifications@verdolo.com>',
      to,
      subject,
      text,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  })
  if (!res.ok) {
    console.error('[email] Resend send failed:', res.status, await res.text())
    return false
  }
  return true
}
