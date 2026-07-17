import 'server-only'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

type Pixel = 'app' | 'site'

const PIXEL_CREDS: Record<Pixel, { id: string | undefined; token: string | undefined }> = {
  app: { id: process.env.NEXT_PUBLIC_META_APP_PIXEL_ID, token: process.env.META_APP_CAPI_TOKEN },
  site: { id: process.env.META_SITE_PIXEL_ID, token: process.env.META_SITE_CAPI_TOKEN },
}

function hash(value: string) {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

export type TrackEventInput = {
  pixel: Pixel
  eventName: string
  eventId: string
  source: 'client' | 'server'
  orgId?: string | null
  userId?: string | null
  email?: string | null
  value?: number
  currency?: string
  properties?: Record<string, unknown>
  eventSourceUrl?: string
  clientIp?: string | null
  clientUserAgent?: string | null
  fbp?: string | null
  fbc?: string | null
}

// Logs to our own events table (source of truth we own) and forwards to Meta's Conversions
// API. The same eventId a client-side fbq() call used lets Meta dedupe the browser Pixel hit
// against this server-side one instead of double-counting the conversion.
export async function trackEvent(input: TrackEventInput) {
  const admin = createAdminClient()
  const { error } = await admin.from('tracking_events').insert({
    event_name: input.eventName,
    event_id: input.eventId,
    pixel: input.pixel,
    source: input.source,
    org_id: input.orgId ?? null,
    user_id: input.userId ?? null,
    properties: input.properties ?? {},
  })

  if (error) {
    // Unique violation on event_id means we've already logged (and CAPI'd) this exact
    // event - a Stripe webhook retry or a duplicate client fire. Skip CAPI too.
    if (error.code === '23505') return
    console.error('[tracking] failed to log event', input.eventName, error)
  }

  await sendToMetaCapi(input)
}

async function sendToMetaCapi(input: TrackEventInput) {
  const creds = PIXEL_CREDS[input.pixel]
  if (!creds.id || !creds.token) return

  const userData: Record<string, unknown> = {}
  if (input.email) userData.em = [hash(input.email)]
  if (input.clientIp) userData.client_ip_address = input.clientIp
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent
  if (input.fbp) userData.fbp = input.fbp
  if (input.fbc) userData.fbc = input.fbc

  const body = {
    data: [
      {
        event_name: input.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: 'website',
        event_source_url: input.eventSourceUrl,
        user_data: userData,
        custom_data: {
          ...(input.value !== undefined ? { value: input.value, currency: input.currency ?? 'USD' } : {}),
          ...input.properties,
        },
      },
    ],
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${creds.id}/events?access_token=${creds.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.error('[tracking] Meta CAPI request failed', input.eventName, await res.text())
    }
  } catch (err) {
    console.error('[tracking] Meta CAPI request threw', input.eventName, err)
  }
}
