'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

type Status = 'trialing' | 'active' | 'past_due' | 'canceled' | null

export default function BillingClient({
  orgId,
  role,
  subscriptionStatus,
  trialEndsAt,
  seatsPurchased,
  activeMemberCount,
  hasStripeCustomer,
  planType,
}: {
  orgId: string
  role: 'owner' | 'admin' | 'member'
  subscriptionStatus: Status
  trialEndsAt: string | null
  seatsPurchased: number
  activeMemberCount: number
  hasStripeCustomer: boolean
  planType: 'subscription' | 'lifetime'
}) {
  const [loading, setLoading] = useState<'checkout' | 'portal' | 'seats' | null>(null)
  const [seatsInput, setSeatsInput] = useState(seatsPurchased)
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null)

  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000)) : 0
  const trialExpired = subscriptionStatus === 'trialing' && trialDaysLeft <= 0

  async function startCheckout() {
    setLoading('checkout')
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    const body = await res.json()
    if (!res.ok) {
      toast.error(body.error ?? 'Could not start checkout')
      setLoading(null)
      return
    }
    setCheckoutSecret(body.clientSecret)
    setLoading(null)
  }

  const fetchClientSecret = useCallback(async () => checkoutSecret!, [checkoutSecret])

  async function openPortal() {
    setLoading('portal')
    const res = await fetch('/api/billing/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    const body = await res.json()
    if (!res.ok) {
      toast.error(body.error ?? 'Could not open billing portal')
      setLoading(null)
      return
    }
    window.location.href = body.url
  }

  async function updateSeats() {
    setLoading('seats')
    try {
      const res = await fetch('/api/billing/seats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, seats: seatsInput }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? 'Could not update seats')
        setLoading(null)
        return
      }
      window.location.reload()
    } catch {
      toast.error('Could not update seats - please try again')
      setLoading(null)
    }
  }

  if (role !== 'owner') {
    return (
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Billing</div>
        {trialExpired || subscriptionStatus === 'canceled' ? (
          <div className="rounded-lg border border-amber-300 bg-amber-100/70 p-4 text-sm text-amber-700">
            This organization&apos;s trial has ended and there&apos;s no active subscription. Ask your org owner to
            subscribe to continue using Verdolo.
          </div>
        ) : (
          <div className="rounded-lg border border-ink/10 bg-white p-4 text-sm text-sage">
            {subscriptionStatus === 'trialing'
              ? `Your organization is on a free trial (${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left).`
              : 'Your organization has an active subscription.'}{' '}
            Only the org owner can manage billing.
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Billing</div>

      <div className="rounded-lg border border-ink/10 bg-white p-4 mb-5">
        {subscriptionStatus === 'trialing' && !trialExpired && (
          <div className="text-sm mb-1">
            <span className="text-green font-semibold">Free trial</span> - {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} left
          </div>
        )}
        {(trialExpired || subscriptionStatus === 'canceled') && (
          <div className="text-sm mb-1 text-amber-700 font-semibold">Trial ended - subscribe to continue</div>
        )}
        {subscriptionStatus === 'active' && (
          <div className="text-sm mb-1 text-green font-semibold">{planType === 'lifetime' ? 'Lifetime license' : 'Active subscription'}</div>
        )}
        {subscriptionStatus === 'past_due' && <div className="text-sm mb-1 text-amber-700 font-semibold">Payment past due - update your payment method</div>}
        <div className="text-xs text-sage">
          {planType === 'lifetime' ? 'Owner + 3 seats included for life · $17/mo per additional seat' : '$29/mo (owner + 2 seats included) · $17/mo per additional seat'} ·{' '}
          {activeMemberCount} of {seatsPurchased} seat{seatsPurchased === 1 ? '' : 's'} used
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {(!hasStripeCustomer || subscriptionStatus === 'canceled' || trialExpired) && (
          <button
            className="rounded bg-accent text-white shadow-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            onClick={startCheckout}
            disabled={loading !== null}
          >
            {loading === 'checkout' ? 'Starting…' : 'Subscribe'}
          </button>
        )}
        {hasStripeCustomer && (
          <button
            className="rounded border border-ink/10 px-4 py-2 text-sm disabled:opacity-50"
            onClick={openPortal}
            disabled={loading !== null}
          >
            {loading === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {hasStripeCustomer && subscriptionStatus !== 'canceled' && (
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Seats</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={activeMemberCount}
              value={seatsInput}
              onChange={(e) => setSeatsInput(Number(e.target.value))}
              className="w-20 rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
            />
            <button
              className="rounded border border-ink/10 px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={updateSeats}
              disabled={loading !== null || seatsInput === seatsPurchased}
            >
              {loading === 'seats' ? 'Updating…' : 'Update seats'}
            </button>
          </div>
          <div className="text-xs text-sage mt-2">Changing seats prorates your next invoice.</div>
        </div>
      )}

      {checkoutSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-lg rounded-lg bg-white p-2 shadow-xl">
            <button
              className="absolute right-3 top-3 z-10 text-sm text-sage hover:text-ink"
              onClick={() => setCheckoutSecret(null)}
              aria-label="Close checkout"
            >
              ✕
            </button>
            <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        </div>
      )}
    </div>
  )
}
