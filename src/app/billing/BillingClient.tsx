'use client'

import { useState } from 'react'

type Status = 'trialing' | 'active' | 'past_due' | 'canceled' | null

export default function BillingClient({
  orgId,
  role,
  subscriptionStatus,
  trialEndsAt,
  seatsPurchased,
  activeMemberCount,
  hasStripeCustomer,
}: {
  orgId: string
  role: 'owner' | 'admin' | 'member'
  subscriptionStatus: Status
  trialEndsAt: string | null
  seatsPurchased: number
  activeMemberCount: number
  hasStripeCustomer: boolean
}) {
  const [loading, setLoading] = useState<'checkout' | 'portal' | 'seats' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seatsInput, setSeatsInput] = useState(seatsPurchased)

  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000)) : 0
  const trialExpired = subscriptionStatus === 'trialing' && trialDaysLeft <= 0

  async function startCheckout() {
    setLoading('checkout')
    setError(null)
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? 'Could not start checkout')
      setLoading(null)
      return
    }
    window.location.href = body.url
  }

  async function openPortal() {
    setLoading('portal')
    setError(null)
    const res = await fetch('/api/billing/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? 'Could not open billing portal')
      setLoading(null)
      return
    }
    window.location.href = body.url
  }

  async function updateSeats() {
    setLoading('seats')
    setError(null)
    const res = await fetch('/api/billing/seats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, seats: seatsInput }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? 'Could not update seats')
      setLoading(null)
      return
    }
    setLoading(null)
    window.location.reload()
  }

  if (role !== 'owner') {
    return (
      <div>
        <h1 className="text-xl font-semibold mb-4">Billing</h1>
        {trialExpired || subscriptionStatus === 'canceled' ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400">
            This organization&apos;s trial has ended and there&apos;s no active subscription. Ask your org owner to
            subscribe to continue using Agency Hub.
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-neutral-400">
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
      <h1 className="text-xl font-semibold mb-5">Billing</h1>

      <div className="rounded-lg border border-white/10 bg-white/5 p-4 mb-5">
        {subscriptionStatus === 'trialing' && !trialExpired && (
          <div className="text-sm mb-1">
            <span className="text-emerald-400 font-semibold">Free trial</span> — {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} left
          </div>
        )}
        {(trialExpired || subscriptionStatus === 'canceled') && (
          <div className="text-sm mb-1 text-amber-400 font-semibold">Trial ended — subscribe to continue</div>
        )}
        {subscriptionStatus === 'active' && <div className="text-sm mb-1 text-emerald-400 font-semibold">Active subscription</div>}
        {subscriptionStatus === 'past_due' && <div className="text-sm mb-1 text-amber-400 font-semibold">Payment past due — update your payment method</div>}
        <div className="text-xs text-neutral-500">
          £25/seat/month · {activeMemberCount} of {seatsPurchased} seat{seatsPurchased === 1 ? '' : 's'} used
        </div>
      </div>

      {error && <div className="text-sm text-red-400 mb-4">{error}</div>}

      <div className="flex gap-2 mb-6">
        {(!hasStripeCustomer || subscriptionStatus === 'canceled' || trialExpired) && (
          <button
            className="rounded bg-white text-black px-4 py-2 text-sm font-medium disabled:opacity-50"
            onClick={startCheckout}
            disabled={loading !== null}
          >
            {loading === 'checkout' ? 'Starting…' : 'Subscribe'}
          </button>
        )}
        {hasStripeCustomer && (
          <button
            className="rounded border border-white/10 px-4 py-2 text-sm disabled:opacity-50"
            onClick={openPortal}
            disabled={loading !== null}
          >
            {loading === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {hasStripeCustomer && subscriptionStatus !== 'canceled' && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Seats</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={activeMemberCount}
              value={seatsInput}
              onChange={(e) => setSeatsInput(Number(e.target.value))}
              className="w-20 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
            />
            <button
              className="rounded border border-white/10 px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={updateSeats}
              disabled={loading !== null || seatsInput === seatsPurchased}
            >
              {loading === 'seats' ? 'Updating…' : 'Update seats'}
            </button>
          </div>
          <div className="text-xs text-neutral-500 mt-2">Changing seats prorates your next invoice.</div>
        </div>
      )}
    </div>
  )
}
