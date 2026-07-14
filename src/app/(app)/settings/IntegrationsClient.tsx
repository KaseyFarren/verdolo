'use client'

import { Section } from '@/components/settings/SettingsUI'
import IntegrationIcon from '@/components/settings/IntegrationIcon'

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
  aiCredits,
}: {
  aiCredits: { tierName: string; limit: number; used: number; remaining: number }
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

      <div className="text-xs font-semibold tracking-wide text-sage mb-2">Integrations</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {COMING_SOON.map((p) => (
          <div key={p.key} className="rounded-2xl bg-white shadow-md p-5 flex items-center gap-3">
            <IntegrationIcon name={p.key} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{p.name}</div>
              <span className="inline-block mt-0.5 text-xs rounded-full bg-sand text-sage px-2 py-0.5">Coming soon</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
