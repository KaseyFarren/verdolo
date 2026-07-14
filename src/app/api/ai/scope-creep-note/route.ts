import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAndConsumeAiCredit } from '@/lib/aiCredits'
import { rateLimit } from '@/lib/rateLimit'
import { buildScopeCreepPrompt, callClaude, extractText } from '@/lib/ai'
import { currencySymbol, effectiveRate, todayKey } from '@/lib/agency'
import { monthElapsedFraction } from '@/lib/period'

export async function POST(request: Request) {
  const { orgId, clientId, periodStart, today: clientToday } = await request.json()
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
  const targetRateCents = ((membership.orgs as any)?.settings?.hourly_cost_cents as number | undefined) || 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currencySign = currencySymbol((membership.orgs as any)?.settings?.currency)

  const { data: client } = await supabase.from('clients').select('id, name, retainer_cents, billing_mode').eq('id', clientId).eq('org_id', orgId).single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  // "using more hours than revenue justifies at target rate" doesn't apply to hourly clients -
  // more hours means proportionally more revenue by definition, no scope-creep risk in the
  // same sense. Check before spending an AI credit on a request that can't say anything useful.
  if (client.billing_mode === 'hourly') {
    return NextResponse.json({ error: 'Scope-creep detection only applies to retainer clients' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI generation is not configured yet' }, { status: 500 })

  // Burst guard on top of the monthly credit cap - stops a member scripting a flood of calls.
  if (!(await rateLimit(`ai:${orgId}`, 20, 60))) {
    return NextResponse.json({ error: 'Too many requests - please slow down and try again in a moment' }, { status: 429 })
  }

  const credit = await checkAndConsumeAiCredit(orgId)
  if (!credit.allowed) {
    return NextResponse.json(
      { error: `You've used all ${credit.limit} AI generations included in your ${credit.tierName} plan this month. More seats raise your monthly allowance.` },
      { status: 402 }
    )
  }

  // periodStart (YYYY-MM) is the month the caller is actually looking at in Profitability -
  // without it this always explained "this month", silently wrong once month navigation exists.
  const now = new Date()
  const [y, m] = /^\d{4}-\d{2}$/.test(periodStart ?? '') ? periodStart.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1]
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const nextMonth = new Date(y, m, 1)
  const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`
  const periodLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const { data: entries } = await supabase
    .from('time_entries')
    .select('duration_seconds')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .not('duration_seconds', 'is', null)
    .gte('started_at', monthStart)
    .lt('started_at', monthEnd)

  const hours = (entries || []).reduce((s, e) => s + (e.duration_seconds || 0), 0) / 3600
  // Mirrors profitabilityForMonth in ReportsClient.tsx - revenue and hours must describe the
  // same window (the calendar month), or a retainer client billed mid-month looks like it
  // made its full monthly revenue already, pushing effectiveRateCents above target even when
  // the header (which prorates by calendar month too) shows the client below it.
  //
  // "today" must come from the browser, not `new Date()` on the server: todayKey() reads
  // local calendar fields, and a serverless function's local clock is UTC while the caller's
  // browser is in their own timezone - for hours around midnight in any zone ahead of UTC the
  // two disagree on which calendar day it is, which shifts the elapsed-month fraction by a
  // full day and produces a revenue figure that doesn't match what the header just rendered.
  const today = /^\d{4}-\d{2}-\d{2}$/.test(clientToday ?? '') ? clientToday : todayKey()
  const monthKey = `${y}-${String(m).padStart(2, '0')}`
  const retainerFraction = monthElapsedFraction(monthKey, today)
  const revenueCents = Math.round((client.retainer_cents || 0) * retainerFraction)
  const effectiveRateCents = effectiveRate(revenueCents, hours) ?? 0

  try {
    const prompt = buildScopeCreepPrompt({
      clientName: client.name,
      hours,
      revenueCents,
      effectiveRateCents,
      targetRateCents,
      isEstimatedRevenue: true,
      periodLabel,
      currencySign,
      fullRetainerCents: client.retainer_cents || 0,
    })
    const result = await callClaude(apiKey, { model: 'claude-sonnet-4-6', max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
    return NextResponse.json({ note: extractText(result) })
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
