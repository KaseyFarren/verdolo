import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAndConsumeAiCredit } from '@/lib/aiCredits'
import { buildScopeCreepPrompt, callClaude, extractText } from '@/lib/ai'

export async function POST(request: Request) {
  const { orgId, clientId } = await request.json()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, orgs(settings)')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not a member of this org' }, { status: 403 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hourlyCostCents = ((membership.orgs as any)?.settings?.hourly_cost_cents as number | undefined) || 0

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI generation is not configured yet' }, { status: 500 })

  const credit = await checkAndConsumeAiCredit(orgId)
  if (!credit.allowed) {
    return NextResponse.json(
      { error: `You've used all ${credit.limit} AI generations included in your ${credit.tierName} plan this month. More seats raise your monthly allowance.` },
      { status: 402 }
    )
  }

  const { data: client } = await supabase.from('clients').select('id, name, retainer_cents').eq('id', clientId).eq('org_id', orgId).single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`

  const [{ data: entries }, { data: paidInvoices }] = await Promise.all([
    supabase
      .from('time_entries')
      .select('duration_seconds')
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .not('duration_seconds', 'is', null)
      .gte('started_at', monthStart)
      .lt('started_at', monthEnd),
    supabase.from('invoices').select('amount_cents').eq('org_id', orgId).eq('client_id', clientId).eq('status', 'paid').gte('paid_at', monthStart).lt('paid_at', monthEnd),
  ])

  const hours = (entries || []).reduce((s, e) => s + (e.duration_seconds || 0), 0) / 3600
  const paidCents = (paidInvoices || []).reduce((s, i) => s + i.amount_cents, 0)
  const revenueCents = paidCents || client.retainer_cents || 0
  const costCents = Math.round(hours * hourlyCostCents)

  try {
    const prompt = buildScopeCreepPrompt({ clientName: client.name, hours, revenueCents, costCents, isEstimatedRevenue: !paidCents })
    const result = await callClaude(apiKey, { model: 'claude-sonnet-4-6', max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
    return NextResponse.json({ note: extractText(result) })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
