import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAndSendInvoice, type LineItem } from '@/lib/invoicing'

export async function POST(request: Request) {
  const { orgId, clientId, lineItems } = (await request.json()) as {
    orgId: string
    clientId: string
    lineItems: LineItem[]
  }
  if (!orgId || !clientId || !lineItems?.length) {
    return NextResponse.json({ error: 'orgId, clientId, and at least one line item are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (membership?.role !== 'owner' && membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins and owners can send invoices' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: org } = await admin
    .from('orgs')
    .select('stripe_connect_account_id, stripe_connect_status')
    .eq('id', orgId)
    .single()
  if (!org?.stripe_connect_account_id || org.stripe_connect_status !== 'active') {
    return NextResponse.json({ error: 'Connect client billing to Stripe first (Settings → Integrations)' }, { status: 400 })
  }
  const accountId = org.stripe_connect_account_id as string

  try {
    const invoiceRow = await createAndSendInvoice({ admin, orgId, clientId, accountId, lineItems })
    return NextResponse.json({ invoice: invoiceRow })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
