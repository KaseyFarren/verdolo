import { createAdminClient } from '@/lib/supabase/admin'
import CreateAccountForm from './create-account-form'

type TokenStatus = 'pending' | 'claimed' | 'expired' | 'not_found'

export default async function CreateAccountPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id: sessionId } = await searchParams

  if (!sessionId) {
    return <CreateAccountForm sessionId={null} initialStatus="not_found" initialEmail={null} />
  }

  const admin = createAdminClient()
  const { data: token } = await admin
    .from('purchase_tokens')
    .select('email, status, expires_at')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle()

  let status: TokenStatus = 'not_found'
  if (token) {
    if (token.status === 'claimed') status = 'claimed'
    else if (token.status === 'pending' && new Date(token.expires_at) > new Date()) status = 'pending'
    else status = 'expired'
  }

  return <CreateAccountForm sessionId={sessionId} initialStatus={status} initialEmail={token?.email ?? null} />
}
