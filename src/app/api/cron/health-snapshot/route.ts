import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthorizedCronRequest } from '@/lib/cronAuth'
import { getHealthScore, getStage, todayKey } from '@/lib/agency'

// Runs daily (see vercel.json). Snapshots the live health-score computation
// (src/lib/agency.ts getHealthScore) for every non-paused client, so a trend can be
// charted over time - there's no way to reconstruct history before this cron started running.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const today = todayKey()

  const { data: clients } = await admin.from('clients').select('id, org_id, stage, status, last_contacted, cadence_days')

  const rows = (clients || []).map((c) => ({
    org_id: c.org_id,
    client_id: c.id,
    snapshot_date: today,
    health: getStage(c) === 'Paused' ? 'paused' : getHealthScore(c.last_contacted, today, c.cadence_days || 7),
  }))

  if (rows.length) {
    await admin.from('client_health_snapshots').upsert(rows, { onConflict: 'client_id,snapshot_date' })
  }

  return NextResponse.json({ snapshotted: rows.length })
}
