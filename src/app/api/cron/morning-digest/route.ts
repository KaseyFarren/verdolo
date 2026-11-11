import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthorizedCronRequest } from '@/lib/cronAuth'
import { runMorningDigest } from '@/lib/digest'

export const maxDuration = 300

// Runs daily (vercel.json). Creates today's recurring tasks for every active org, then sends the
// morning summary to clients (orgs with settings.client_digest on) and team members (orgs with
// settings.team_digest on). See lib/digest.ts.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = new URL(request.url).searchParams.get('org') ?? undefined
  const summary = await runMorningDigest(createAdminClient(), { onlyOrgId: orgId })
  return NextResponse.json(summary)
}
