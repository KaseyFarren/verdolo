import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthorizedCronRequest } from '@/lib/cronAuth'
import { getStage, getOffsetDate, todayKey } from '@/lib/agency'

// Runs daily (see vercel.json). Mirrors the Dashboard's "Contract expiring soon" banner window
// (contract_ends within the next 30 days, not yet past, client not Paused) but turns it into an
// actionable task assigned to the client's point of contact instead of a read-only banner.
// due_date = contract_ends (not "today") so the unique constraint in migration 0068 dedupes
// against the expiry cycle itself, not the day the cron happened to run - if the contract is
// later renewed to a new contract_ends, that's a new due_date and a fresh task gets created.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const today = todayKey()
  const thirtyDaysOut = getOffsetDate(30)

  const { data: clients } = await admin
    .from('clients')
    .select('id, org_id, name, contract_ends, primary_contact_id, stage, status')
    .not('contract_ends', 'is', null)
    .not('primary_contact_id', 'is', null)
    .lte('contract_ends', thirtyDaysOut)
    .gte('contract_ends', today)

  const rows = (clients || [])
    .filter((c) => getStage(c) !== 'Paused')
    .map((c) => ({
      org_id: c.org_id,
      client_id: c.id,
      title: `Renew contract: ${c.name}`,
      due_date: c.contract_ends,
      priority: 'High',
      notes: `Contract ends ${c.contract_ends}. Reach out to discuss renewal.`,
      assignee_ids: [c.primary_contact_id],
      assigned_to: c.primary_contact_id,
      done: false,
      is_auto: true,
      auto_type: 'contract_expiring',
    }))

  if (!rows.length) return NextResponse.json({ created: 0 })

  const { data, error } = await admin
    .from('tasks')
    .upsert(rows, { onConflict: 'org_id,client_id,due_date,auto_type', ignoreDuplicates: true })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ created: data?.length || 0 })
}
