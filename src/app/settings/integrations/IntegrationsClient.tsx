'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Section } from '@/components/settings/SettingsUI'
import IntegrationIcon from '@/components/settings/IntegrationIcon'
import Button from '@/components/ui/Button'

const COMING_SOON = [
  { key: 'gcal', name: 'Google Calendar' },
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
  isAdmin,
  initialApiKey,
  hasKey: initialHasKey,
}: {
  orgId: string
  isAdmin: boolean
  initialApiKey: string
  hasKey: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [apiKeyInput, setApiKeyInput] = useState(initialApiKey)
  const [hasKey, setHasKey] = useState(initialHasKey)
  const [saving, setSaving] = useState(false)

  async function saveApiKey() {
    setSaving(true)
    await supabase.from('org_secrets').upsert({ org_id: orgId, anthropic_api_key: apiKeyInput.trim() })
    setHasKey(!!apiKeyInput.trim())
    setSaving(false)
  }

  async function removeApiKey() {
    await supabase.from('org_secrets').upsert({ org_id: orgId, anthropic_api_key: null })
    setApiKeyInput('')
    setHasKey(false)
  }

  return (
    <>
      <Section label="AI Messages">
        <div className="flex items-center gap-3 mb-3">
          <IntegrationIcon name="anthropic" />
          <div>
            <div className="text-sm font-medium">Anthropic API key</div>
            <div className="text-xs text-sage">Shared across your org, used to generate daily client messages. {!isAdmin && 'Only admins can view or change it.'}</div>
          </div>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <input
              type="password"
              className="flex-1 rounded border border-ink/10 bg-white px-3 py-2 text-sm"
              placeholder="sk-ant-…"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <Button variant="primary" onClick={saveApiKey} disabled={saving}>
              Save
            </Button>
            {hasKey && (
              <button className="text-xs text-red-600 shrink-0" onClick={removeApiKey}>
                Remove
              </button>
            )}
          </div>
        ) : (
          <div className="text-sm">{hasKey ? '● Connected' : '○ Not connected'}</div>
        )}
      </Section>

      <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">Integrations</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GmailCard />
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

function GmailCard() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<{ connected: boolean; email: string | null } | null>(null)
  const feedback = searchParams.get('gmail')

  useEffect(() => {
    fetch('/api/integrations/google/status')
      .then((r) => r.json())
      .then(setStatus)
  }, [])

  async function disconnect() {
    await fetch('/api/integrations/google/disconnect', { method: 'POST' })
    setStatus({ connected: false, email: null })
  }

  return (
    <div className="rounded-2xl bg-white shadow-md p-4 flex items-center gap-3">
      <IntegrationIcon name="gmail" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Gmail</div>
        {status?.connected ? (
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-green truncate">● {status.email}</span>
          </div>
        ) : (
          <div className="text-xs text-sage mt-0.5">Read and reply to client emails</div>
        )}
        {feedback === 'error' && <div className="text-xs text-red-600 mt-0.5">Connection failed — try again</div>}
      </div>
      {status?.connected ? (
        <button className="text-xs text-red-600 shrink-0" onClick={disconnect}>
          Disconnect
        </button>
      ) : (
        <a href="/api/integrations/google/connect" className="text-xs rounded border border-ink/10 px-2 py-1 shrink-0">
          Connect
        </a>
      )}
    </div>
  )
}
