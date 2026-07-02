import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ')

function redirectUri(origin: string) {
  return `${origin}/api/integrations/google/callback`
}

export function buildGoogleAuthUrl(origin: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCodeForTokens(origin: string, code: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(origin),
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`)
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }>
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`)
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

export async function fetchGoogleEmail(accessToken: string) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Failed to fetch Google account info')
  const data = await res.json()
  return data.email as string
}

/** Returns a valid access token for this user's Gmail connection, refreshing it first if expired. */
export async function getValidGmailAccessToken(orgId: string, userId: string) {
  const admin = createAdminClient()
  const { data: conn } = await admin
    .from('integration_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .maybeSingle()

  if (!conn) return null

  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0
  if (Date.now() < expiresAt - 60_000) return conn.access_token_encrypted as string

  if (!conn.refresh_token_encrypted) return null
  const refreshed = await refreshGoogleAccessToken(conn.refresh_token_encrypted)
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  await admin
    .from('integration_connections')
    .update({ access_token_encrypted: refreshed.access_token, expires_at: newExpiresAt })
    .eq('id', conn.id)
  return refreshed.access_token
}
