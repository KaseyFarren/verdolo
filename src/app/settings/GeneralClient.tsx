'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Row, Section, Toggle } from '@/components/settings/SettingsUI'

type Settings = {
  eod_hour?: number
  exclude_weekends?: boolean
  notifications?: boolean
}

export default function GeneralClient({
  orgId,
  isAdmin,
  settings,
}: {
  orgId: string
  isAdmin: boolean
  settings: Settings
}) {
  const supabase = useMemo(() => createClient(), [])
  const [eodHour, setEodHour] = useState(settings.eod_hour ?? 17)
  const [excludeWeekends, setExcludeWeekends] = useState(settings.exclude_weekends ?? true)
  const [notifications, setNotifications] = useState(settings.notifications ?? true)
  const [saved, setSaved] = useState(false)

  async function saveSettings(next: Partial<Settings>) {
    if (!isAdmin) return
    const merged = { eod_hour: eodHour, exclude_weekends: excludeWeekends, notifications, ...next }
    await supabase.from('orgs').update({ settings: merged }).eq('id', orgId)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <Section label="General">
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
  )
}
