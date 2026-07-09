import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Pre-auth, read-only lookup used only to poll for the rare case where Stripe's redirect to
// /create-account beats the webhook that creates the purchase_tokens row - never exposes
// anything beyond status/email, and never creates or mutates a row.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('session_id')
  if (!sessionId) return NextResponse.json({ status: 'not_found' })

  const admin = createAdminClient()
  const { data: token } = await admin
    .from('purchase_tokens')
    .select('email, status, expires_at')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle()

  if (!token) return NextResponse.json({ status: 'not_found' })
  if (token.status === 'claimed') return NextResponse.json({ status: 'claimed' })
  if (token.status === 'pending' && new Date(token.expires_at) > new Date()) {
    return NextResponse.json({ status: 'pending', email: token.email })
  }
  return NextResponse.json({ status: 'expired' })
}
