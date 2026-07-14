'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ConfirmDialog'

type Org = {
  id: string
  name: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string | null
  plan_type: string | null
  trial_ends_at: string | null
  current_period_end: string | null
  seats_purchased: number
  created_at: string
}

type Member = {
  id: string
  user_id: string
  role: string
  status: string
  invited_email: string | null
  joined_at: string | null
  created_at: string
}

const STATUS_STYLES: Record<string, string> = {
  trialing: 'bg-amber-100 text-amber-700',
  active: 'bg-green/10 text-green',
  past_due: 'bg-red-100 text-red-700',
  canceled: 'bg-ink/10 text-sage',
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function OrgDetailClient({
  org,
  members,
  activeMemberCount,
}: {
  org: Org
  members: Member[]
  activeMemberCount: number
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [loading, setLoading] = useState<string | null>(null)
  const [trialDays, setTrialDays] = useState(14)
  const [seatsInput, setSeatsInput] = useState(org.seats_purchased)

  async function post(url: string, body: object, label: string) {
    setLoading(label)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setLoading(null)
    if (!res.ok) {
      toast.error(data.error ?? `Failed: ${label}`)
      return false
    }
    return true
  }

  async function extendTrial() {
    const ok = await post(`/api/admin/orgs/${org.id}/extend-trial`, { days: trialDays }, 'extend-trial')
    if (ok) {
      toast.success(`Trial extended by ${trialDays} day${trialDays === 1 ? '' : 's'}`)
      router.refresh()
    }
  }

  async function compSeats() {
    const ok = await post(`/api/admin/orgs/${org.id}/seats`, { seats: seatsInput }, 'seats')
    if (ok) {
      toast.success(`Seats set to ${seatsInput} (Stripe billing unchanged)`)
      router.refresh()
    }
  }

  async function resendInvite(memberId: string, email: string | null) {
    const ok = await post(`/api/admin/orgs/${org.id}/members/${memberId}/resend-invite`, {}, `resend-${memberId}`)
    if (ok) toast.success(`Invite re-sent to ${email ?? 'member'}`)
  }

  async function setPlanType(planType: 'subscription' | 'lifetime') {
    const ok = await post(`/api/admin/orgs/${org.id}/set-plan-type`, { planType }, `plan-${planType}`)
    if (ok) {
      toast.success(planType === 'lifetime' ? 'Lifetime license granted' : 'Reverted to subscription plan')
      router.refresh()
    }
  }

  async function cancelSubscription(immediate: boolean) {
    const confirmed = await confirm({
      title: immediate ? 'Cancel immediately?' : 'Cancel at period end?',
      message: immediate
        ? 'This cancels the Stripe subscription right now and cuts off access immediately. It does not issue a refund for time already paid for.'
        : 'This schedules the subscription to cancel at the end of the current billing period. The org keeps access until then.',
      confirmLabel: immediate ? 'Cancel immediately' : 'Cancel at period end',
      danger: true,
    })
    if (!confirmed) return
    const ok = await post(
      `/api/admin/orgs/${org.id}/cancel-subscription`,
      { immediate },
      immediate ? 'cancel-immediate' : 'cancel-period-end'
    )
    if (ok) {
      toast.success(immediate ? 'Subscription canceled immediately' : 'Subscription will cancel at period end')
      router.refresh()
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="font-heading font-bold text-lg">{org.name}</h1>
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
              STATUS_STYLES[org.subscription_status ?? ''] ?? 'bg-ink/10 text-sage'
            }`}
          >
            {org.subscription_status ?? 'none'}
          </span>
          {org.plan_type === 'lifetime' && (
            <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-accent/10 text-accent">Lifetime</span>
          )}
        </div>
        <div className="text-xs text-sage mt-1">
          {org.id} · created {formatDate(org.created_at)}
          {org.stripe_customer_id && (
            <>
              {' · '}
              <a
                href={`https://dashboard.stripe.com/customers/${org.stripe_customer_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-ink"
              >
                Open in Stripe
              </a>
            </>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <div className="text-xs font-semibold tracking-wide text-sage mb-3">Subscription</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-4">
          <div>
            <div className="text-xs text-sage">Trial ends</div>
            <div>{formatDate(org.trial_ends_at)}</div>
          </div>
          <div>
            <div className="text-xs text-sage">Next bill</div>
            <div>{formatDate(org.current_period_end)}</div>
          </div>
          <div>
            <div className="text-xs text-sage">Seats</div>
            <div>
              {activeMemberCount}/{org.seats_purchased}
            </div>
          </div>
          <div>
            <div className="text-xs text-sage">Subscription ID</div>
            <div className="font-mono text-xs truncate">{org.stripe_subscription_id ?? '-'}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-6 pt-4 border-t border-ink/10">
          <div>
            <div className="text-xs text-sage mb-1">Extend trial</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                value={trialDays}
                onChange={(e) => setTrialDays(Number(e.target.value))}
                className="w-16 rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-sage">days</span>
              <Button size="sm" onClick={extendTrial} disabled={loading !== null}>
                {loading === 'extend-trial' ? 'Extending…' : 'Extend'}
              </Button>
            </div>
          </div>

          <div>
            <div className="text-xs text-sage mb-1">Comp seats (doesn&apos;t change Stripe billing)</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={activeMemberCount}
                value={seatsInput}
                onChange={(e) => setSeatsInput(Number(e.target.value))}
                className="w-16 rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
              />
              <Button size="sm" onClick={compSeats} disabled={loading !== null || seatsInput === org.seats_purchased}>
                {loading === 'seats' ? 'Updating…' : 'Update'}
              </Button>
            </div>
          </div>

          <div>
            <div className="text-xs text-sage mb-1">Plan type</div>
            {org.plan_type === 'lifetime' ? (
              <Button size="sm" variant="secondary" onClick={() => setPlanType('subscription')} disabled={loading !== null}>
                {loading === 'plan-subscription' ? 'Reverting…' : 'Revert to subscription'}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setPlanType('lifetime')} disabled={loading !== null}>
                {loading === 'plan-lifetime' ? 'Granting…' : 'Grant lifetime license'}
              </Button>
            )}
          </div>

          {org.stripe_subscription_id && org.subscription_status !== 'canceled' && (
            <div className="flex items-center gap-2 ml-auto">
              <Button size="sm" variant="danger" onClick={() => cancelSubscription(true)} disabled={loading !== null}>
                {loading === 'cancel-immediate' ? 'Canceling…' : 'Cancel immediately'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => cancelSubscription(false)} disabled={loading !== null}>
                {loading === 'cancel-period-end' ? 'Scheduling…' : 'Cancel at period end'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <div className="text-xs font-semibold tracking-wide text-sage mb-3">Members</div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10">
              <th className="text-left text-xs font-semibold tracking-wide text-sage px-2 py-2">Email</th>
              <th className="text-left text-xs font-semibold tracking-wide text-sage px-2 py-2">Role</th>
              <th className="text-left text-xs font-semibold tracking-wide text-sage px-2 py-2">Status</th>
              <th className="text-left text-xs font-semibold tracking-wide text-sage px-2 py-2">Joined</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-ink/5 last:border-0">
                <td className="px-2 py-2">{m.invited_email ?? '-'}</td>
                <td className="px-2 py-2 text-sage">{m.role}</td>
                <td className="px-2 py-2 text-sage">{m.status}</td>
                <td className="px-2 py-2 text-sage">{formatDate(m.joined_at)}</td>
                <td className="px-2 py-2 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => resendInvite(m.id, m.invited_email)}
                    disabled={loading !== null}
                  >
                    {loading === `resend-${m.id}` ? 'Sending…' : 'Resend invite'}
                  </Button>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-sage">
                  No members
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
