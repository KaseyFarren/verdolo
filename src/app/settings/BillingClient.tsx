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
        {subscriptionStatus === 'active' && <div className="text-sm mb-1 text-green font-semibold">Active subscription</div>}
        {subscriptionStatus === 'past_due' && <div className="text-sm mb-1 text-amber-700 font-semibold">Payment past due - update your payment method</div>}
        <div className="text-xs text-sage">
          £25/seat/month · {activeMemberCount} of {seatsPurchased} seat{seatsPurchased === 1 ? '' : 's'} used
        </div>
      </div>

      {error && <div className="text-sm text-red-600 mb-4">{error}</div>}

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
    </div>
  )
}
