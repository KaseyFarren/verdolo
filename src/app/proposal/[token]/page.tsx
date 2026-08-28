import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { centsToDollars, currencySymbol, dollarsToCents, formatDate } from '@/lib/agency'
import AcceptForm from './AcceptForm'

// Public, unauthenticated page - '/proposal/' is in PUBLIC_PATHS (src/lib/supabase/middleware.ts)
// so a logged-out visitor reaches this at all. Every other read in the app goes through
// user-scoped RLS (is_org_member); an anonymous visitor has no session, so this reads via the
// service-role client instead, scoped to a single row by an unguessable token - same shape as
// the purchase_tokens flow (see src/app/api/create-account/lookup/route.ts).
export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()

  const { data: proposal } = await admin
    .from('proposals')
    .select('id, org_id, title, status, content, amount_cents, accepted_at, accepted_by_name, share_revoked_at')
    .eq('share_token', token)
    .maybeSingle()

  if (!proposal || proposal.share_revoked_at) notFound()

  const { data: org } = await admin.from('orgs').select('name, accent_color, settings').eq('id', proposal.org_id).maybeSingle()
  const currencySign = currencySymbol((org?.settings as { currency?: string } | null)?.currency)
  const content = (proposal.content ?? {}) as { overview?: string; deliverables?: string[]; pricing?: { label: string; amount: string }[]; terms?: string }

  return (
    <div className="min-h-screen bg-cream text-ink" style={{ '--accent': org?.accent_color || '#dd6b2c' } as React.CSSProperties}>
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>
      <div className="max-w-2xl mx-auto px-5 py-10 md:py-14">
        <div className="text-xs font-semibold tracking-wide text-sage uppercase">{org?.name ?? 'Proposal'}</div>
        <h1 className="text-2xl font-semibold mt-1">{proposal.title}</h1>

        <div className="mt-8 space-y-6">
          {content.overview && (
            <section>
              <h2 className="text-xs font-semibold tracking-wide text-sage mb-2">Overview</h2>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{content.overview}</p>
            </section>
          )}

          {!!content.deliverables?.length && (
            <section>
              <h2 className="text-xs font-semibold tracking-wide text-sage mb-2">Deliverables</h2>
              <ul className="text-sm space-y-1 list-disc pl-5">
                {content.deliverables.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </section>
          )}

          {!!content.pricing?.length && (
            <section>
              <h2 className="text-xs font-semibold tracking-wide text-sage mb-2">Pricing</h2>
              <div className="rounded-2xl border border-ink/8 bg-white p-5">
                {content.pricing.filter((r) => r.label || r.amount).map((row, i) => (
                  <div key={i} className="flex justify-between text-sm py-1">
                    <span>{row.label || 'Line item'}</span>
                    <span>{currencySign}{centsToDollars(dollarsToCents(row.amount || '0')).toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold pt-2 mt-2 border-t border-ink/10">
                  <span>Total</span>
                  <span>{currencySign}{centsToDollars(proposal.amount_cents).toLocaleString()}</span>
                </div>
              </div>
            </section>
          )}

          {content.terms && (
            <section>
              <h2 className="text-xs font-semibold tracking-wide text-sage mb-2">Terms</h2>
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-sage">{content.terms}</p>
            </section>
          )}
        </div>

        <div className="mt-10 pt-6 border-t border-ink/10">
          {proposal.status === 'signed' ? (
            <div className="text-sm text-green font-medium">
              Accepted by {proposal.accepted_by_name} on {proposal.accepted_at ? formatDate(proposal.accepted_at.slice(0, 10)) : ''}
            </div>
          ) : proposal.status === 'declined' ? (
            <div className="text-sm text-sage">This proposal was declined.</div>
          ) : (
            <AcceptForm token={token} />
          )}
        </div>
      </div>
    </div>
  )
}
