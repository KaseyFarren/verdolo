import { NextResponse } from 'next/server'
import { trackEvent, type TrackEventInput } from '@/lib/tracking/meta'

// verdolo-site (verdolo.com) calls this cross-origin to log/CAPI its own Pixel events into
// the same tracking_events table the app writes to - app.verdolo.com itself calls it
// same-origin. Only these two known origins are allowed; anything else gets no CORS headers
// and the browser blocks the response.
const ALLOWED_ORIGINS = new Set(['https://verdolo.com', 'https://app.verdolo.com'])

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) })
}

export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get('origin'))
  const body = await request.json().catch(() => null)

  if (!body?.eventName || !body?.eventId || (body.pixel !== 'app' && body.pixel !== 'site')) {
    return NextResponse.json({ error: 'Invalid event payload' }, { status: 400, headers })
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  const input: TrackEventInput = {
    pixel: body.pixel,
    eventName: String(body.eventName),
    eventId: String(body.eventId),
    source: 'client',
    orgId: body.orgId ?? null,
    userId: body.userId ?? null,
    email: body.email ?? null,
    value: typeof body.value === 'number' ? body.value : undefined,
    currency: body.currency ?? undefined,
    properties: body.properties ?? undefined,
    eventSourceUrl: body.eventSourceUrl ?? undefined,
    clientIp: forwardedFor ? forwardedFor.split(',')[0].trim() : null,
    clientUserAgent: request.headers.get('user-agent'),
    fbp: body.fbp ?? null,
    fbc: body.fbc ?? null,
  }

  await trackEvent(input)
  return NextResponse.json({ ok: true }, { headers })
}
