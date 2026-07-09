'use client'

import { useState } from 'react'
import { Section } from '@/components/settings/SettingsUI'
import IntegrationIcon from '@/components/settings/IntegrationIcon'
import Button from '@/components/ui/Button'

const COMING_SOON = [
  { key: 'slack', name: 'Slack' },
  { key: 'zoom', name: 'Zoom' },
  { key: 'teams', name: 'Microsoft Teams' },
  { key: 'notion', name: 'Notion' },
  { key: 'hubspot', name: 'HubSpot' },
  { key: 'zapier', name: 'Zapier' },
  { key: 'calendly', name: 'Calendly' },
]

export default function IntegrationsClient({
  orgId,
  isOwner,
  aiCredits,
  stripeConnectStatus,
}: {
  orgId: string
  isOwner: boolean
  aiCredits: { tierName: string; limit: number; used: number; remaining: number }
  stripeConnectStatus: 'not_connected' | 'pending' | 'active'
}) {
  const pct = Math.min(100, Math.round((aiCredits.used / Math.max(aiCredits.limit, 1)) * 100))

  return (
    <>
      <Section label="AI Messages">
        <div className="flex items-center gap-3 mb-3">
          <IntegrationIcon name="anthropic" />
          <div>
            <div className="text-sm font-medium">AI generation</div>
            <div className="text-xs text-sage">Included with your plan - no API key to manage.</div>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-sage mb-1">
          <span>
            {aiCredits.used} / {aiCredits.limit} generations used this month
          </span>
          <span>{aiCredits.tierName} plan</span>
        </div>
        <div className="h-1.5 rounded-full bg-sand overflow-hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        {aiCredits.remaining === 0 && (
          <div className="text-xs text-red-600 mt-1.5">You've used all your AI generations for this month. More seats raise your monthly allowance.</div>
        )}
      </Section>

      <Section label="Client Billing">
        <StripeConnectCard orgId={orgId} isOwner={isOwner} status={stripeConnectStatus} />
      </Section>

      <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Integrations</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {COMING_SOON.map((p) => (
          <div key={p.key} className="rounded-2xl bg-white shadow-md p-4 flex items-center gap-3">
            <IntegrationIcon name={p.key} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{p.name}</div>
              <span className="inline-block mt-0.5 text-[10px] rounded-full bg-sand text-sage px-2 py-0.5">Coming soon</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function StripeConnectCard({
  orgId,
  isOwner,
  status,
}: {
  orgId: string
  isOwner: boolean
  status: 'not_connected' | 'pending' | 'active'
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/billing/connect/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else {
      setError(data.error ?? 'Failed to start Stripe onboarding')
      setLoading(false)
    }
  }

  const label = status === 'active' ? '● Connected' : status === 'pending' ? '○ Onboarding in progress' : '○ Not connected'

  return (
    <div className="flex items-center gap-3">
      <IntegrationIcon name="stripe" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Stripe (client invoicing)</div>
        <div className={`text-xs mt-0.5 ${status === 'active' ? 'text-green' : 'text-sage'}`}>
          {isOwner || status !== 'not_connected' ? label : 'Invoice and collect payment from your own clients'}
        </div>
        {!isOwner && <div className="text-xs text-sage mt-0.5">Only the org owner can connect billing.</div>}
        {error && <div className="text-xs text-red-600 mt-0.5">{error}</div>}
      </div>
      {isOwner && status !== 'active' && (
        <Button variant="primary" onClick={connect} disabled={loading}>
          {status === 'pending' ? 'Finish setup' : 'Connect Stripe'}
        </Button>
      )}
    </div>
  )
}
