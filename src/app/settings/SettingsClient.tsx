'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import { clearPin, getIdleMinutes, hasPinSet, setIdleMinutes, setPin } from '@/components/PinLock'
import { getInitials, todayKey } from '@/lib/agency'

const ACCENT_PRESETS = ['#dd6b2c', '#1f3320', '#e98a4f', '#5d6b5c', '#c9973c', '#8a6a3c']

type Settings = {
  eod_hour?: number
  exclude_weekends?: boolean
  notifications?: boolean
}

export default function SettingsClient({
  orgId,
  userId,
  role,
  settings,
  initialApiKey,
  initialDisplayName,
  initialAvatarUrl,
  subscriptionStatus,
  trialEndsAt,
  initialAccentColor,
}: {
  orgId: string
  userId: string
  role: 'owner' | 'admin' | 'member'
  settings: Settings
  initialApiKey: string
  initialDisplayName: string
  initialAvatarUrl: string
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled' | null
  trialEndsAt: string | null
  initialAccentColor: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const confirm = useConfirm()
  const isAdmin = role === 'admin' || role === 'owner'
  const [eodHour, setEodHour] = useState(settings.eod_hour ?? 17)
  const [excludeWeekends, setExcludeWeekends] = useState(settings.exclude_weekends ?? true)
  const [notifications, setNotifications] = useState(settings.notifications ?? true)
  const [apiKeyInput, setApiKeyInput] = useState(initialApiKey)
  const [hasKey, setHasKey] = useState(!!initialApiKey)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [accentColor, setAccentColor] = useState(initialAccentColor)

  async function saveSettings(next: Partial<Settings>) {
    if (!isAdmin) return
    const merged = { eod_hour: eodHour, exclude_weekends: excludeWeekends, notifications, ...next }
    await supabase.from('orgs').update({ settings: merged }).eq('id', orgId)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  async function saveAccentColor(color: string) {
    if (!isAdmin) return
    setAccentColor(color)
    await supabase.from('orgs').update({ accent_color: color }).eq('id', orgId)
    router.refresh()
    toast.success('Accent color updated')
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
    const ok = await confirm({ message: 'Clear all completed tasks?', confirmLabel: 'Clear' })
    if (!ok) return
    await supabase.from('tasks').delete().eq('org_id', orgId).eq('done', true)
    toast.success('Completed tasks cleared')
  }

  async function resetAll() {
    if (!isAdmin) return
    const ok = await confirm({
      title: 'Delete all org data?',
      message: 'This permanently deletes every client, task, and note for this org. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true,
    })
    if (!ok) return
    await supabase.from('tasks').delete().eq('org_id', orgId)
    await supabase.from('client_notes').delete().eq('org_id', orgId)
    await supabase.from('clients').delete().eq('org_id', orgId)
    toast.success('All org data deleted')
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      <ProfileSection orgId={orgId} userId={userId} initialDisplayName={initialDisplayName} initialAvatarUrl={initialAvatarUrl} />

      {isAdmin && (
        <Section label="Appearance">
          <Row title="Accent color" subtitle="Used for links, focus states, and the active nav highlight">
            <div className="flex items-center gap-2">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => saveAccentColor(c)}
                  className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                  style={{ background: c, borderColor: accentColor === c ? '#fff' : 'transparent' }}
                  aria-label={c}
                />
              ))}
              <input
                type="color"
                value={accentColor}
                onChange={(e) => saveAccentColor(e.target.value)}
                className="h-6 w-6 rounded-full border-0 bg-transparent p-0 cursor-pointer"
              />
            </div>
          </Row>
        </Section>
      )}

      {role === 'owner' && <BillingSummary subscriptionStatus={subscriptionStatus} trialEndsAt={trialEndsAt} />}

      <SecuritySection />

      <Section label="AI Messages">
        <div className="text-sm font-medium mb-1">Anthropic API key</div>
        <div className="text-xs text-sage mb-3">Shared across your org, used to generate daily client messages. {!isAdmin && 'Only admins can view or change it.'}</div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <input
              type="password"
              className="flex-1 rounded border border-ink/10 bg-white px-3 py-2 text-sm"
              placeholder="sk-ant-…"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <button className="rounded bg-accent text-white shadow-md px-3 py-2 text-sm font-medium" onClick={saveApiKey} disabled={saving}>
              Save
            </button>
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

      <Section label="Integrations">
        <GmailConnect />
      </Section>

      <Section label="Schedule">
        <Row title="Skip weekends" subtitle="No auto check-ins on Sat / Sun">
          <Toggle checked={excludeWeekends} disabled={!isAdmin} onChange={(v) => { setExcludeWeekends(v); saveSettings({ exclude_weekends: v }) }} />
        </Row>
        <Row title="EOD reminder hour" subtitle="Show banner after this hour">
          <select
            className="rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
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
        {saved && <div className="text-xs text-green mt-2">Saved</div>}
      </Section>

      <Section label="Data">
        <Row title="Export all data (JSON)" subtitle="Full backup — clients, tasks, notes">
          <button className="text-xs rounded border border-ink/10 px-2 py-1" onClick={exportJSON}>
            Export
          </button>
        </Row>
        <Row title="Export clients (CSV)" subtitle="Spreadsheet-ready client list">
          <button className="text-xs rounded border border-ink/10 px-2 py-1" onClick={exportCSV}>
            Export
          </button>
        </Row>
        <Row title="Clear completed tasks" subtitle="Remove all tasks marked as done">
          <button className="text-xs text-red-600" onClick={clearCompleted}>
            Clear
          </button>
        </Row>
        {isAdmin && (
          <Row title="Reset all data" subtitle="Delete tasks, clients, and notes for this org">
            <button className="text-xs text-red-600" onClick={resetAll}>
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
      <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">{label}</div>
      <div className="rounded-lg border border-ink/10 bg-white p-4">{children}</div>
    </div>
  )
}

function Row({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-ink/10 last:border-b-0 last:pb-0 first:pt-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-sage mt-0.5">{subtitle}</div>
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      className={`w-10 h-[22px] rounded-full relative shrink-0 transition-colors ${checked ? 'bg-white' : 'bg-ink/5'} ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
    >
      <div className={`absolute top-[3px] h-4 w-4 rounded-full bg-black transition-all ${checked ? 'left-[20px]' : 'left-[3px]'}`} />
    </div>
  )
}

function ProfileSection({
  orgId,
  userId,
  initialDisplayName,
  initialAvatarUrl,
}: {
  orgId: string
  userId: string
  initialDisplayName: string
  initialAvatarUrl: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveDisplayName() {
    await supabase.from('org_members').update({ display_name: displayName.trim() || null }).eq('org_id', orgId).eq('user_id', userId)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  async function uploadAvatar(file: File) {
    setUploading(true)
    setError(null)
    const ext = file.name.split('.').pop() || 'png'
    const path = `${userId}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
      return
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const publicUrl = `${data.publicUrl}?t=${Date.now()}`
    await supabase.from('org_members').update({ avatar_url: publicUrl }).eq('org_id', orgId).eq('user_id', userId)
    setAvatarUrl(publicUrl)
    setUploading(false)
  }

  return (
    <Section label="Profile">
      <Row title="Nickname" subtitle="Shown instead of your email across the app">
        <div className="flex items-center gap-2">
          <input
            className="rounded border border-ink/10 bg-white px-2 py-1.5 text-sm w-40"
            placeholder="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={saveDisplayName}
          />
          {saved && <span className="text-xs text-green">Saved</span>}
        </div>
      </Row>
      <Row title="Profile picture" subtitle="JPG or PNG, shown on Team and task assignments">
        <div className="flex items-center gap-2">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-ink/5 flex items-center justify-center text-xs font-semibold">{getInitials(displayName)}</div>
          )}
          <label className="text-xs rounded border border-ink/10 px-2 py-1 cursor-pointer">
            {uploading ? 'Uploading…' : 'Upload'}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadAvatar(file)
              }}
            />
          </label>
        </div>
      </Row>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </Section>
  )
}

function SecuritySection() {
  const confirm = useConfirm()
  const [hasPin, setHasPin] = useState(false)
  const [idleMinutes, setIdleMinutesState] = useState(5)
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setHasPin(hasPinSet())
    setIdleMinutesState(getIdleMinutes())
  }, [])

  async function savePin() {
    setError(null)
    if (!/^\d{4,6}$/.test(newPin)) {
      setError('PIN must be 4-6 digits')
      return
    }
    if (newPin !== confirmPin) {
      setError('PINs don’t match')
      return
    }
    await setPin(newPin)
    setHasPin(true)
    setChanging(false)
    setNewPin('')
    setConfirmPin('')
    toast.success('PIN set for this device')
  }

  async function removePin() {
    const ok = await confirm({ title: 'Remove PIN lock?', message: 'The app will no longer lock on this device.', confirmLabel: 'Remove', danger: true })
    if (!ok) return
    clearPin()
    setHasPin(false)
    toast.success('PIN removed')
  }

  function changeIdle(v: number) {
    setIdleMinutesState(v)
    setIdleMinutes(v)
  }

  return (
    <Section label="Security">
      <Row title="Device PIN lock" subtitle="Locks this browser after inactivity — a quick deterrent, not a replacement for your login">
        {hasPin && !changing ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green">● PIN set</span>
            <button className="text-xs rounded border border-ink/10 px-2 py-1" onClick={() => setChanging(true)}>
              Change
            </button>
            <button className="text-xs text-red-600" onClick={removePin}>
              Remove
            </button>
          </div>
        ) : (
          <button className="text-xs rounded border border-ink/10 px-2 py-1" onClick={() => setChanging(true)}>
            {changing ? 'Cancel' : 'Set PIN'}
          </button>
        )}
      </Row>
      {changing && (
        <div className="pt-2.5">
          <div className="flex gap-2 mb-2">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="New PIN"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              className="flex-1 rounded border border-ink/10 bg-white px-3 py-2 text-sm"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="Confirm PIN"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              className="flex-1 rounded border border-ink/10 bg-white px-3 py-2 text-sm"
            />
          </div>
          {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
          <div className="flex gap-2">
            <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={() => { setChanging(false); setError(null) }}>
              Cancel
            </button>
            <button className="rounded bg-accent text-white shadow-md px-3 py-1.5 text-sm font-medium" onClick={savePin}>
              Save PIN
            </button>
          </div>
        </div>
      )}
      {hasPin && (
        <Row title="Lock after" subtitle="Minutes of inactivity before locking">
          <select
            value={idleMinutes}
            onChange={(e) => changeIdle(Number(e.target.value))}
            className="rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
          >
            {[2, 5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </Row>
      )}
    </Section>
  )
}

function BillingSummary({
  subscriptionStatus,
  trialEndsAt,
}: {
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled' | null
  trialEndsAt: string | null
}) {
  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000)) : 0
  const trialExpired = subscriptionStatus === 'trialing' && trialDaysLeft <= 0

  let label = 'No subscription'
  let color = 'text-sage'
  if (subscriptionStatus === 'trialing' && !trialExpired) {
    label = `Free trial · ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left`
    color = 'text-green'
  } else if (subscriptionStatus === 'active') {
    label = 'Active subscription'
    color = 'text-green'
  } else if (subscriptionStatus === 'past_due') {
    label = 'Payment past due'
    color = 'text-amber-700'
  } else {
    label = 'Trial ended'
    color = 'text-amber-700'
  }

  return (
    <Section label="Billing">
      <Row title="Plan" subtitle="£25/seat/month">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${color}`}>{label}</span>
          <Link href="/billing" className="text-xs rounded border border-ink/10 px-2 py-1">
            Manage →
          </Link>
        </div>
      </Row>
    </Section>
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
          <span className="text-xs text-green">● {status.email}</span>
          <button className="text-xs text-red-600" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <a href="/api/integrations/google/connect" className="text-xs rounded border border-ink/10 px-2 py-1">
          Connect Gmail
        </a>
      )}
      {feedback === 'error' && <span className="text-xs text-red-600 ml-2">Connection failed — try again</span>}
    </Row>
  )
}
