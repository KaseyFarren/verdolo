'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { loadStripe } from '@stripe/stripe-js'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { XIcon } from '@/components/ui/icons'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

type Status = 'trialing' | 'active' | 'past_due' | 'canceled' | null

type Invoice = {
  id: string
  number: string | null
  created: number
  amountPaid: number
  currency: string
  status: string | null
  hostedInvoiceUrl: string | null
  invoicePdf: string | null
}

function formatMoney(amountInCents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
    amountInCents / 100
  )
}

function UpdatePaymentMethodForm({
  orgId,
  onDone,
  onCancel,
}: {
  orgId: string
  onDone: () => void
  onCancel: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)

    const { setupIntent, error } = await stripe.confirmSetup({ elements, redirect: 'if_required' })
    if (error || !setupIntent) {
      toast.error(error?.message ?? 'Could not update payment method')
      setSubmitting(false)
      return
    }

    const res = await fetch('/api/billing/payment-method/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, setupIntentId: setupIntent.id }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error ?? 'Could not save payment method')
      setSubmitting(false)
      return
    }

    toast.success('Payment method updated')
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <PaymentElement />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!stripe || submitting}
          className="rounded bg-accent text-white shadow-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save card'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded border border-ink/10 px-4 py-2 text-sm disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

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
  const [loading, setLoading] = useState<'checkout' | 'seats' | 'panel' | 'payment' | 'cancel' | null>(null)
  const [seatsInput, setSeatsInput] = useState(seatsPurchased)
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null)

  const [showPanel, setShowPanel] = useState(false)
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  const [paymentSecret, setPaymentSecret] = useState<string | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

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

  async function openBillingPanel() {
    setLoading('panel')
    setShowPanel(true)
    const res = await fetch(`/api/billing/details?orgId=${orgId}`)
    const body = await res.json()
    if (!res.ok) {
      toast.error(body.error ?? 'Could not load billing details')
      setLoading(null)
      setShowPanel(false)
      return
    }
    setInvoices(body.invoices)
    setCancelAtPeriodEnd(body.cancelAtPeriodEnd)
    setLoading(null)
  }

  function closeBillingPanel() {
    setShowPanel(false)
    setPaymentSecret(null)
    setConfirmingCancel(false)
    setInvoices(null)
  }

  async function startPaymentMethodUpdate() {
    setLoading('payment')
    const res = await fetch('/api/billing/payment-method', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    const body = await res.json()
    if (!res.ok) {
      toast.error(body.error ?? 'Could not start payment method update')
      setLoading(null)
      return
    }
    setPaymentSecret(body.clientSecret)
    setLoading(null)
  }

  async function setCancellation(cancel: boolean) {
    setLoading('cancel')
    const res = await fetch('/api/billing/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, cancel }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(body.error ?? 'Could not update subscription')
      setLoading(null)
      return
    }
    setCancelAtPeriodEnd(body.cancelAtPeriodEnd)
    setConfirmingCancel(false)
    toast.success(cancel ? 'Your subscription will cancel at the end of the billing period' : 'Your subscription will continue')
    setLoading(null)
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
        <div className="text-xs font-semibold tracking-wide text-sage mb-2">Billing</div>
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
      <div className="text-xs font-semibold tracking-wide text-sage mb-2">Billing</div>

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
            onClick={openBillingPanel}
            disabled={loading !== null}
          >
            {loading === 'panel' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {hasStripeCustomer && subscriptionStatus !== 'canceled' && (
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <div className="text-xs font-semibold tracking-wide text-sage mb-2">Seats</div>
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
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white p-2 shadow-xl">
            <button
              className="absolute right-3 top-3 z-10 text-sm text-sage hover:text-ink"
              onClick={() => setCheckoutSecret(null)}
              aria-label="Close checkout"
            >
              <XIcon size={15} />
            </button>
            <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        </div>
      )}

      {showPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <button
              className="absolute right-3 top-3 z-10 text-sm text-sage hover:text-ink"
              onClick={closeBillingPanel}
              aria-label="Close"
            >
              <XIcon size={15} />
            </button>
            <h2 className="text-xs font-semibold tracking-wide text-sage mb-4">Manage billing</h2>

            {invoices === null ? (
              <p className="text-sm text-sage">Loading…</p>
            ) : (
              <div className="flex flex-col gap-6">
                <div>
                  <div className="text-xs font-semibold tracking-wide text-sage mb-2">Payment method</div>
                  {paymentSecret ? (
                    <Elements stripe={stripePromise} options={{ clientSecret: paymentSecret }}>
                      <UpdatePaymentMethodForm
                        orgId={orgId}
                        onDone={() => setPaymentSecret(null)}
                        onCancel={() => setPaymentSecret(null)}
                      />
                    </Elements>
                  ) : (
                    <button
                      className="rounded border border-ink/10 px-3 py-1.5 text-sm disabled:opacity-50"
                      onClick={startPaymentMethodUpdate}
                      disabled={loading !== null}
                    >
                      {loading === 'payment' ? 'Starting…' : 'Update card'}
                    </button>
                  )}
                </div>

                <div>
                  <div className="text-xs font-semibold tracking-wide text-sage mb-2">Invoices</div>
                  {invoices.length === 0 ? (
                    <p className="text-sm text-sage">No invoices yet.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {invoices.map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between rounded border border-ink/10 px-3 py-2 text-sm"
                        >
                          <div>
                            <div>{new Date(inv.created * 1000).toLocaleDateString()}</div>
                            <div className="text-xs text-sage capitalize">{inv.status}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-medium">{formatMoney(inv.amountPaid, inv.currency)}</span>
                            {inv.hostedInvoiceUrl && (
                              <a
                                href={inv.hostedInvoiceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs underline text-sage hover:text-ink"
                              >
                                View
                              </a>
                            )}
                            {inv.invoicePdf && (
                              <a
                                href={inv.invoicePdf}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs underline text-sage hover:text-ink"
                              >
                                PDF
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {planType !== 'lifetime' && (
                  <div>
                    <div className="text-xs font-semibold tracking-wide text-sage mb-2">Subscription</div>
                    {cancelAtPeriodEnd ? (
                      <div className="flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-100/70 p-3 text-sm text-amber-700">
                        <span>Cancels at the end of the billing period.</span>
                        <button
                          className="rounded border border-ink/10 bg-white px-3 py-1.5 text-xs disabled:opacity-50"
                          onClick={() => setCancellation(false)}
                          disabled={loading !== null}
                        >
                          {loading === 'cancel' ? 'Updating…' : 'Keep subscription'}
                        </button>
                      </div>
                    ) : confirmingCancel ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-sage">Cancel at the end of the billing period?</span>
                        <button
                          className="rounded border border-red-600 text-red-600 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                          onClick={() => setCancellation(true)}
                          disabled={loading !== null}
                        >
                          {loading === 'cancel' ? 'Canceling…' : 'Yes, cancel'}
                        </button>
                        <button
                          className="rounded border border-ink/10 px-3 py-1.5 text-xs"
                          onClick={() => setConfirmingCancel(false)}
                        >
                          Never mind
                        </button>
                      </div>
                    ) : (
                      <button
                        className="text-xs text-red-600"
                        onClick={() => setConfirmingCancel(true)}
                      >
                        Cancel subscription
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
