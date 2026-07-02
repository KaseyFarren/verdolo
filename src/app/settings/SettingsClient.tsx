'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { todayKey } from '@/lib/agency'

type Settings = {
  eod_hour?: number
  exclude_weekends?: boolean
  notifications?: boolean
}

export default function SettingsClient({
  orgId,
  role,
  settings,
  initialApiKey,
}: {
  orgId: string
  role: 'admin' | 'member'
  settings: Settings
  initialApiKey: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const isAdmin = role === 'admin'
  const [eodHour, setEodHour] = useState(settings.eod_hour ?? 17)
  const [excludeWeekends, setExcludeWeekends] = useState(settings.exclude_weekends ?? true)
  const [notifications, setNotifications] = useState(settings.notifications ?? true)
  const [apiKeyInput, setApiKeyInput] = useState(initialApiKey)
  const [hasKey, setHasKey] = useState(!!initialApiKey)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function saveSettings(next: Partial<Settings>) {
    if (!isAdmin) return
    const merged = { eod_hour: eodHour, exclude_weekends: excludeWeekends, notifications, ...next }
    await supabase.from('orgs').update({ settings: merged }).eq('id', orgId)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

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

  async function exportJSON() {
    const [{ data: clients }, { data: tasks }, { data: notes }] = await Promise.all([
      supabase.from('clients').select('*').eq('org_id', orgId),
      supabase.from('tasks').select('*').eq('org_id', orgId),
      supabase.from('client_notes').select('*').eq('org_id', orgId),
    ])
    triggerDownload(JSON.stringify({ clients, tasks, notes, exported: new Date().toISOString() }, null, 2), `agency-hub-export-${todayKey()}.json`, 'application/json')
  }

  async function exportCSV() {
    const { data: clients } = await supabase.from('clients').select('*').eq('org_id', orgId)
    const rows = [
      ['Name', 'Business', 'Stage', 'Retainer', 'Platform', 'Service', 'Tone', 'Last Contacted', 'Contract Ends'],
      ...(clients || []).map((c) => [c.name, c.business || '', c.stage || '', c.retainer_cents ? c.retainer_cents / 100 : '', c.platform || '', c.service || '', c.tone || '', c.last_contacted || '', c.contract_ends || '']),
    ]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    triggerDownload(csv, `agency-hub-clients-${todayKey()}.csv`, 'text/csv')
  }

  async function clearCompleted() {
    if (!window.confirm('Clear all completed tasks?')) return
    await supabase.from('tasks').delete().eq('org_id', orgId).eq('done', true)
  }

  async function resetAll() {
    if (!isAdmin) return
    if (!window.confirm('Delete ALL clients, tasks, and notes for this org? This cannot be undone.')) return
    await supabase.from('tasks').delete().eq('org_id', orgId)
    await supabase.from('client_notes').delete().eq('org_id', orgId)
    await supabase.from('clients').delete().eq('org_id', orgId)
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      <Section label="AI Messages">
        <div className="text-sm font-medium mb-1">Anthropic API key</div>
        <div className="text-xs text-neutral-500 mb-3">Shared across your org, used to generate daily client messages. {!isAdmin && 'Only admins can view or change it.'}</div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <input
              type="password"
              className="flex-1 rounded border border-white/10 bg-black/30 px-3 py-2 text-sm"
              placeholder="sk-ant-…"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <button className="rounded bg-white text-black px-3 py-2 text-sm font-medium" onClick={saveApiKey} disabled={saving}>
              Save
            </button>
            {hasKey && (
              <button className="text-xs text-red-400 shrink-0" onClick={removeApiKey}>
                Remove
              </button>
            )}
          </div>
        ) : (
          <div className="text-sm">{hasKey ? '● Connected' : '○ Not connected'}</div>
        )}
      </Section>

      <Section label="Integrations">
        <GmailConnect />
      </Section>

      <Section label="Schedule">
        <Row title="Skip weekends" subtitle="No auto check-ins on Sat / Sun">
          <Toggle checked={excludeWeekends} disabled={!isAdmin} onChange={(v) => { setExcludeWeekends(v); saveSettings({ exclude_weekends: v }) }} />
        </Row>
        <Row title="EOD reminder hour" subtitle="Show banner after this hour">
          <select
            className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
            value={eodHour}
            disabled={!isAdmin}
            onChange={(e) => { const v = Number(e.target.value); setEodHour(v); saveSettings({ eod_hour: v }) }}
          >
            {[14, 15, 16, 17, 18, 19, 20].map((h) => (
              <option key={h} value={h}>
                {h < 12 ? h + 'am' : h === 12 ? '12pm' : h - 12 + 'pm'}
              </option>
            ))}
          </select>
        </Row>
        <Row title="Desktop notifications" subtitle="EOD alert + morning summary">
          <Toggle checked={notifications} disabled={!isAdmin} onChange={(v) => { setNotifications(v); saveSettings({ notifications: v }) }} />
        </Row>
        {saved && <div className="text-xs text-emerald-400 mt-2">Saved</div>}
      </Section>

      <Section label="Data">
        <Row title="Export all data (JSON)" subtitle="Full backup — clients, tasks, notes">
          <button className="text-xs rounded border border-white/10 px-2 py-1" onClick={exportJSON}>
            Export
          </button>
        </Row>
        <Row title="Export clients (CSV)" subtitle="Spreadsheet-ready client list">
          <button className="text-xs rounded border border-white/10 px-2 py-1" onClick={exportCSV}>
            Export
          </button>
        </Row>
        <Row title="Clear completed tasks" subtitle="Remove all tasks marked as done">
          <button className="text-xs text-red-400" onClick={clearCompleted}>
            Clear
          </button>
        </Row>
        {isAdmin && (
          <Row title="Reset all data" subtitle="Delete tasks, clients, and notes for this org">
            <button className="text-xs text-red-400" onClick={resetAll}>
              Reset
            </button>
          </Row>
        )}
      </Section>
    </div>
  )
}

function triggerDownload(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">{label}</div>
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">{children}</div>
    </div>
  )
}

function Row({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/10 last:border-b-0 last:pb-0 first:pt-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-neutral-500 mt-0.5">{subtitle}</div>
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      className={`w-10 h-[22px] rounded-full relative shrink-0 transition-colors ${checked ? 'bg-white' : 'bg-white/15'} ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
    >
      <div className={`absolute top-[3px] h-4 w-4 rounded-full bg-black transition-all ${checked ? 'left-[20px]' : 'left-[3px]'}`} />
    </div>
  )
}

function GmailConnect() {
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
    <Row title="Gmail" subtitle="Connect your own inbox to read and reply to client emails from inside Agency Hub">
      {status?.connected ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-emerald-400">● {status.email}</span>
          <button className="text-xs text-red-400" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <a href="/api/integrations/google/connect" className="text-xs rounded border border-white/10 px-2 py-1">
          Connect Gmail
        </a>
      )}
      {feedback === 'error' && <span className="text-xs text-red-400 ml-2">Connection failed — try again</span>}
    </Row>
  )
}
