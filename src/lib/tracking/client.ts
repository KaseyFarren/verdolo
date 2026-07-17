'use client'

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

// Fires the app's Meta Pixel (browser-side) and logs the same event to /api/track, which
// both records it in our own tracking_events table and forwards it to Meta's Conversions
// API server-side. Passing the same eventId to both lets Meta dedupe the two hits instead
// of double-counting the conversion.
export function trackApp(
  eventName: string,
  properties?: Record<string, unknown>,
  opts?: { custom?: boolean; eventId?: string; email?: string; orgId?: string; userId?: string; value?: number; currency?: string }
) {
  const eventId = opts?.eventId ?? crypto.randomUUID()

  window.fbq?.(opts?.custom ? 'trackCustom' : 'track', eventName, { ...properties }, { eventID: eventId })

  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      pixel: 'app',
      eventName,
      eventId,
      properties,
      email: opts?.email,
      orgId: opts?.orgId,
      userId: opts?.userId,
      value: opts?.value,
      currency: opts?.currency,
      eventSourceUrl: window.location.href,
      fbp: readCookie('_fbp'),
      fbc: readCookie('_fbc'),
    }),
  }).catch(() => {})

  return eventId
}
