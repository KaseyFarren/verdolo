import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, clientIp } from '@/lib/rateLimit'
import { apiError } from '@/lib/apiError'

// Unauthenticated by design (the visitor is a prospect, not a logged-in user) - rate-limited per
// IP the same way as src/app/api/create-account/lookup/route.ts, the only other pre-auth
// service-role route in the app.
export async function POST(request: Request) {
  const ip = clientIp(request)
  if (!(await rateLimit(`proposal-accept:${ip}`, 10, 60))) {
    return apiError('Too many requests', 429)
  }

  const body = await request.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!token || !name) return apiError('Missing name', 400)

  const admin = createAdminClient()
  const { data: proposal, error: lookupError } = await admin
    .from('proposals')
    .select('id, org_id, client_id, status, share_revoked_at')
    .eq('share_token', token)
    .maybeSingle()

  if (lookupError || !proposal || proposal.share_revoked_at) return apiError('Proposal not found', 404)
  if (proposal.status === 'signed' || proposal.status === 'declined') return apiError('This proposal has already been decided', 409)

  const now = new Date().toISOString()
  const { error: updateError } = await admin
    .from('proposals')
    .update({ status: 'signed', decided_at: now, accepted_at: now, accepted_by_name: name, accepted_ip: ip })
    .eq('id', proposal.id)

  if (updateError) return apiError('Failed to accept proposal', 500, updateError)

  // Mirrors the client-side promotion in ProposalsClient.tsx:174 (Lead -> Active on sign) -
  // that path only runs for status changes made inside the app, so a link acceptance needs
  // its own copy of the same side effect.
  const { data: client } = await admin.from('clients').select('stage').eq('id', proposal.client_id).maybeSingle()
  if (client?.stage === 'Lead') {
    await admin.from('clients').update({ stage: 'Active' }).eq('id', proposal.client_id)
  }

  return NextResponse.json({ ok: true })
}
