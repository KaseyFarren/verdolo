import { getStripe } from '@/lib/stripe'
import type Stripe from 'stripe'

// Live-billing pre-flight. Reads the *deployed* environment (so on app.verdolo.com this
// reflects production) and actively hits the Stripe API to prove the configured price IDs
// and webhook actually resolve in the current key's mode - a test price ID left behind
// after flipping the secret key to live would fail silently at checkout otherwise.
export const dynamic = 'force-dynamic'

const EXPECTED_WEBHOOK_PATH = '/api/billing/webhook'
const EXPECTED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]

type Status = 'ok' | 'warn' | 'bad'

function keyMode(key: string | undefined): { mode: 'live' | 'test' | 'unknown'; label: string } {
  if (!key) return { mode: 'unknown', label: 'not set' }
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return { mode: 'live', label: 'LIVE' }
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return { mode: 'test', label: 'TEST' }
  return { mode: 'unknown', label: 'unrecognised prefix' }
}

function money(price: Stripe.Price): string {
  const amount = price.unit_amount != null ? (price.unit_amount / 100).toFixed(2) : '?'
  const cur = (price.currency ?? '').toUpperCase()
  const recurring = price.recurring ? ` / ${price.recurring.interval}` : ' (one-time)'
  const productName =
    price.product && typeof price.product === 'object' && 'name' in price.product
      ? (price.product as Stripe.Product).name
      : null
  return `${cur} ${amount}${recurring}${productName ? ` - ${productName}` : ''}`
}

async function checkPrice(
  stripe: Stripe | null,
  id: string | undefined
): Promise<{ status: Status; detail: string }> {
  if (!id) return { status: 'bad', detail: 'env var not set' }
  if (!stripe) return { status: 'warn', detail: `${id} - cannot verify (no secret key)` }
  try {
    const price = await stripe.prices.retrieve(id, { expand: ['product'] })
    if (!price.active) return { status: 'warn', detail: `${id} resolves but is ARCHIVED - ${money(price)}` }
    return { status: 'ok', detail: `${id} - ${money(price)}` }
  } catch (e) {
    return { status: 'bad', detail: `${id} - ${(e as Error).message}` }
  }
}

const dot: Record<Status, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
}
const chip: Record<Status, string> = {
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
}

function Row({ status, title, detail }: { status: Status; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot[status]}`} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="mt-0.5 break-words font-mono text-xs text-ink/60">{detail}</div>
      </div>
    </div>
  )
}

export default async function AdminBillingPage() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const seatPriceId = process.env.STRIPE_SEAT_PRICE_ID
  const lifetimeSeatPriceId = process.env.STRIPE_LIFETIME_EXTRA_SEAT_PRICE_ID
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  const { mode, label: modeLabel } = keyMode(secretKey)
  const stripe = secretKey ? getStripe() : null

  // Confirm the key actually authenticates, and grab the account so we know it's the right one.
  let accountStatus: Status = 'warn'
  let accountDetail = 'no secret key set'
  if (stripe) {
    try {
      // No-arg form returns the account behind the API key; only the by-id overload is typed.
      const account = await (stripe.accounts as unknown as { retrieve: () => Promise<Stripe.Account> }).retrieve()
      const chargesReady = account.charges_enabled
      accountStatus = chargesReady ? 'ok' : 'warn'
      accountDetail = `${account.id}${account.email ? ` (${account.email})` : ''} - charges_enabled: ${chargesReady}${
        chargesReady ? '' : ' (account not fully activated for live payments)'
      }`
    } catch (e) {
      accountStatus = 'bad'
      accountDetail = `secret key rejected by Stripe: ${(e as Error).message}`
    }
  }

  const seatCheck = await checkPrice(stripe, seatPriceId)
  const lifetimeCheck = await checkPrice(stripe, lifetimeSeatPriceId)

  // Webhook endpoints registered in this Stripe account/mode.
  let webhookStatus: Status = 'warn'
  let webhookDetail = 'cannot list webhooks (no secret key)'
  if (stripe) {
    try {
      const endpoints = await stripe.webhookEndpoints.list({ limit: 20 })
      const match = endpoints.data.find((w) => w.url.endsWith(EXPECTED_WEBHOOK_PATH))
      if (!match) {
        webhookStatus = 'bad'
        webhookDetail = `no endpoint ending in ${EXPECTED_WEBHOOK_PATH} registered in this mode (${endpoints.data.length} endpoint(s) found)`
      } else {
        const events = match.enabled_events
        const listensAll = events.includes('*')
        const missing = listensAll ? [] : EXPECTED_EVENTS.filter((e) => !events.includes(e))
        const disabled = match.status !== 'enabled'
        webhookStatus = missing.length || disabled ? 'warn' : 'ok'
        webhookDetail = `${match.url} - status: ${match.status}${
          missing.length ? ` - MISSING events: ${missing.join(', ')}` : ' - all required events present'
        }`
      }
    } catch (e) {
      webhookStatus = 'bad'
      webhookDetail = `webhook list failed: ${(e as Error).message}`
    }
  }

  const webhookSecretStatus: Status = webhookSecret
    ? webhookSecret.startsWith('whsec_')
      ? 'ok'
      : 'warn'
    : 'bad'
  const webhookSecretDetail = webhookSecret
    ? webhookSecret.startsWith('whsec_')
      ? 'STRIPE_WEBHOOK_SECRET is set (signature verification enabled)'
      : 'set, but does not start with whsec_ - looks wrong'
    : 'STRIPE_WEBHOOK_SECRET not set - all incoming webhooks will be rejected'

  // Overall verdict.
  const checks: Status[] = [
    accountStatus,
    seatCheck.status,
    lifetimeCheck.status,
    webhookStatus,
    webhookSecretStatus,
  ]
  const anyBad = checks.includes('bad')
  const anyWarn = checks.includes('warn')
  const liveReady = mode === 'live' && !anyBad && !anyWarn
  const verdict: Status = anyBad ? 'bad' : mode !== 'live' || anyWarn ? 'warn' : 'ok'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-ink">Billing diagnostic</h1>
        <p className="mt-1 text-sm text-ink/60">
          Live-mode pre-flight. Reflects the environment this deployment is running in.
        </p>
      </div>

      <div className={`rounded-xl border p-4 ${chip[verdict]}`}>
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${dot[verdict]}`} />
          <span className="font-heading font-bold">
            Stripe mode: {modeLabel}
            {mode === 'test' && ' - not charging real money yet'}
          </span>
        </div>
        <p className="mt-2 text-sm">
          {liveReady
            ? 'All checks pass and the account is live. Real cards will be charged.'
            : anyBad
              ? 'One or more checks failed - see red items below. Do not sell until resolved.'
              : mode !== 'live'
                ? 'Configuration looks internally consistent, but the secret key is not a live key. Flip all four env vars to their live values to go live.'
                : 'Live key detected, but some checks need attention - see amber items below.'}
        </p>
      </div>

      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="mb-1 font-heading text-sm font-bold uppercase tracking-wide text-ink/50">Checks</h2>
        <div className="divide-y divide-ink/5">
          <Row status={accountStatus} title="Stripe account" detail={accountDetail} />
          <Row
            status={seatCheck.status}
            title="Seat price (STRIPE_SEAT_PRICE_ID)"
            detail={seatCheck.detail}
          />
          <Row
            status={lifetimeCheck.status}
            title="Lifetime extra-seat price (STRIPE_LIFETIME_EXTRA_SEAT_PRICE_ID)"
            detail={lifetimeCheck.detail}
          />
          <Row status={webhookStatus} title="Webhook endpoint" detail={webhookDetail} />
          <Row
            status={webhookSecretStatus}
            title="Webhook signing secret"
            detail={webhookSecretDetail}
          />
        </div>
      </div>

      <p className="text-xs text-ink/40">
        This page never displays secret values - only key prefixes and Stripe API lookups. Price and
        webhook checks are live Stripe API calls, so a config that points at the wrong mode shows up
        here as a failed lookup rather than a silent checkout error.
      </p>
    </div>
  )
}
