import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'

// Reads one calendar month's ai_usage_log rows and aggregates in JS. Fine at current
// scale (a few thousand generations/month across all orgs); if usage grows large enough that
// this row count becomes a real page-load cost, replace with a Postgres aggregate (group by
// org_id/route) instead of raising the limit.
const ROW_LIMIT = 20_000

type UsageRow = {
  org_id: string
  route: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_micros: number | null
  orgs: { name: string } | { name: string }[] | null
}

function money(micros: number) {
  const dollars = micros / 1_000_000
  return dollars < 0.01 && dollars > 0 ? `<$0.01` : `$${dollars.toFixed(2)}`
}

// Per-generation cost is almost always sub-cent (a haiku call can be a few hundredths of a cent),
// so the 2-decimal money() rounds nearly everything down to "<$0.01" - useless for comparing
// routes against each other. This keeps enough precision to actually see the difference.
function moneyPrecise(micros: number) {
  const dollars = micros / 1_000_000
  if (dollars === 0) return '$0.00'
  return dollars < 0.01 ? `$${dollars.toFixed(5)}` : `$${dollars.toFixed(2)}`
}

function orgName(row: UsageRow) {
  const o = Array.isArray(row.orgs) ? row.orgs[0] : row.orgs
  return o?.name ?? 'Unknown org'
}

export default async function AdminAiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const admin = createAdminClient()
  const { month } = await searchParams
  const now = new Date()

  // month param is "YYYY-MM"; anything malformed falls back to the current month.
  const parsed = month && /^\d{4}-\d{2}$/.test(month) ? month.split('-').map(Number) : null
  const year = parsed ? parsed[0] : now.getFullYear()
  const monthIndex = parsed ? parsed[1] - 1 : now.getMonth()

  const monthStart = new Date(year, monthIndex, 1)
  const monthEnd = new Date(year, monthIndex + 1, 1)
  const isCurrentMonth = monthStart.getFullYear() === now.getFullYear() && monthStart.getMonth() === now.getMonth()

  const prevMonth = new Date(year, monthIndex - 1, 1)
  const nextMonth = new Date(year, monthIndex + 1, 1)
  const monthParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const { data: rows } = await admin
    .from('ai_usage_log')
    .select('org_id, route, model, input_tokens, output_tokens, cost_micros, orgs(name)')
    .gte('created_at', monthStart.toISOString())
    .lt('created_at', monthEnd.toISOString())
    .order('created_at', { ascending: false })
    .limit(ROW_LIMIT)

  const usage = (rows ?? []) as unknown as UsageRow[]

  const totalCostMicros = usage.reduce((s, r) => s + (r.cost_micros ?? 0), 0)
  const totalGenerations = usage.length
  const totalInputTokens = usage.reduce((s, r) => s + r.input_tokens, 0)
  const totalOutputTokens = usage.reduce((s, r) => s + r.output_tokens, 0)

  const byRoute = new Map<string, { generations: number; costMicros: number; inputTokens: number; outputTokens: number; model: string }>()
  for (const r of usage) {
    const cur = byRoute.get(r.route) ?? { generations: 0, costMicros: 0, inputTokens: 0, outputTokens: 0, model: r.model }
    cur.generations += 1
    cur.costMicros += r.cost_micros ?? 0
    cur.inputTokens += r.input_tokens
    cur.outputTokens += r.output_tokens
    byRoute.set(r.route, cur)
  }
  const routeRows = [...byRoute.entries()].sort((a, b) => b[1].costMicros - a[1].costMicros)

  const byOrg = new Map<string, { name: string; generations: number; costMicros: number }>()
  for (const r of usage) {
    const cur = byOrg.get(r.org_id) ?? { name: orgName(r), generations: 0, costMicros: 0 }
    cur.generations += 1
    cur.costMicros += r.cost_micros ?? 0
    byOrg.set(r.org_id, cur)
  }
  const orgRows = [...byOrg.entries()].sort((a, b) => b[1].costMicros - a[1].costMicros).slice(0, 25)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-bold text-ink">AI usage & cost</h1>
          <p className="mt-1 text-sm text-ink/60">
            {monthLabel}, across all orgs. Actual Anthropic API spend - not AI-credit counts (each
            org&apos;s credit cap is a generation count, not a dollar cap; a `tasks-from-doc` call on a large
            document can cost far more per credit than a short `one-message` call).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm">
          <Link
            href={`/admin/ai-usage?month=${monthParam(prevMonth)}`}
            className="rounded-lg border border-ink/10 bg-white px-3 py-1.5 font-medium text-ink/70 hover:text-ink transition-colors"
          >
            ← Prev
          </Link>
          {!isCurrentMonth && (
            <Link
              href={`/admin/ai-usage?month=${monthParam(nextMonth)}`}
              className="rounded-lg border border-ink/10 bg-white px-3 py-1.5 font-medium text-ink/70 hover:text-ink transition-colors"
            >
              Next →
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-ink/40">Total spend</div>
          <div className="mt-1 font-heading text-2xl font-bold text-ink">{moneyPrecise(totalCostMicros)}</div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-ink/40">Generations</div>
          <div className="mt-1 font-heading text-2xl font-bold text-ink">{totalGenerations.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-ink/40">Input tokens</div>
          <div className="mt-1 font-heading text-2xl font-bold text-ink">{totalInputTokens.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-ink/40">Output tokens</div>
          <div className="mt-1 font-heading text-2xl font-bold text-ink">{totalOutputTokens.toLocaleString()}</div>
        </div>
      </div>

      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="mb-3 font-heading text-sm font-bold tracking-wide text-ink/50">By route</h2>
        {routeRows.length === 0 ? (
          <p className="text-sm text-ink/50">No AI generations logged yet this month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
                <th className="pb-2 font-medium">Route</th>
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium">Generations</th>
                <th className="pb-2 font-medium">Avg cost/gen</th>
                <th className="pb-2 font-medium">Total cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {routeRows.map(([route, r]) => (
                <tr key={route}>
                  <td className="py-2 font-medium text-ink">{route}</td>
                  <td className="py-2 font-mono text-xs text-ink/60">{r.model}</td>
                  <td className="py-2 text-ink/70">{r.generations.toLocaleString()}</td>
                  <td className="py-2 text-ink/70">{moneyPrecise(r.costMicros / r.generations)}</td>
                  <td className="py-2 font-medium text-ink">{moneyPrecise(r.costMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="mb-3 font-heading text-sm font-bold tracking-wide text-ink/50">Top orgs by spend (top 25)</h2>
        {orgRows.length === 0 ? (
          <p className="text-sm text-ink/50">No AI generations logged yet this month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
                <th className="pb-2 font-medium">Org</th>
                <th className="pb-2 font-medium">Generations</th>
                <th className="pb-2 font-medium">Total cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {orgRows.map(([orgId, o]) => (
                <tr key={orgId}>
                  <td className="py-2 font-medium text-ink">{o.name}</td>
                  <td className="py-2 text-ink/70">{o.generations.toLocaleString()}</td>
                  <td className="py-2 font-medium text-ink">{money(o.costMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
