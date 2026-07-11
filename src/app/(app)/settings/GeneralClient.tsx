'use client'

import { useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Row, Section, Toggle } from '@/components/settings/SettingsUI'
import InfoTooltip from '@/components/ui/InfoTooltip'
import CustomSelect from '@/components/ui/CustomSelect'
import { CURRENCIES, currencySymbol, type Currency } from '@/lib/agency'

type Settings = {
  eod_hour?: number
  exclude_weekends?: boolean
  notifications?: boolean
  hourly_cost_cents?: number
  brand_voice?: string
  currency?: Currency
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
  const [hourlyCost, setHourlyCost] = useState(String((settings.hourly_cost_cents ?? 0) / 100))
  const [currency, setCurrency] = useState<Currency>(settings.currency ?? 'usd')
  const [saved, setSaved] = useState(false)
  const [rateStatus, setRateStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const rateDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Target rate saves as you type (debounced) with its own Saving/Saved feedback, so the value is
  // committed without needing to click off the field.
  function onRateChange(v: string) {
    setHourlyCost(v)
    if (!isAdmin) return
    setRateStatus('saving')
    if (rateDebounce.current) clearTimeout(rateDebounce.current)
    rateDebounce.current = setTimeout(async () => {
      await saveSettings({ hourly_cost_cents: Math.round(parseFloat(v) * 100) || 0 })
      setRateStatus('saved')
      setTimeout(() => setRateStatus((s) => (s === 'saved' ? 'idle' : s)), 2000)
    }, 700)
  }

  // Spread the full settings object (not just this component's own fields) - otherwise saving
  // here would silently wipe out settings owned by other tabs (e.g. VoiceClient's brand_voice)
  // since the jsonb column is replaced wholesale, not merged, on every write.
  async function saveSettings(next: Partial<Settings>) {
    if (!isAdmin) return
    const merged = {
      ...settings,
      eod_hour: eodHour,
      exclude_weekends: excludeWeekends,
      notifications,
      hourly_cost_cents: Math.round(parseFloat(hourlyCost) * 100) || 0,
      currency,
      ...next,
    }
    await supabase.from('orgs').update({ settings: merged }).eq('id', orgId)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <Section label="General">
      <Row title="Skip weekends" subtitle="No auto check-ins on Sat / Sun">
        <Toggle checked={excludeWeekends} disabled={!isAdmin} onChange={(v) => { setExcludeWeekends(v); saveSettings({ exclude_weekends: v }) }} />
      </Row>
      <Row
        title={
          <>
            EOD <InfoTooltip content="End of day" /> reminder hour
          </>
        }
        subtitle="Show banner after this hour"
      >
        <div className="w-28">
          <CustomSelect
            value={String(eodHour)}
            disabled={!isAdmin}
            onChange={(v) => { const n = Number(v); setEodHour(n); saveSettings({ eod_hour: n }) }}
            options={[14, 15, 16, 17, 18, 19, 20].map((h) => ({ value: String(h), label: h < 12 ? h + 'am' : h === 12 ? '12pm' : h - 12 + 'pm' }))}
          />
        </div>
      </Row>
      <Row
        title="Desktop notifications"
        subtitle={
          <>
            EOD <InfoTooltip content="End of day" /> alert + morning summary
          </>
        }
      >
        <Toggle checked={notifications} disabled={!isAdmin} onChange={(v) => { setNotifications(v); saveSettings({ notifications: v }) }} />
      </Row>
      <Row dataTour="currency-row" title="Client billing currency" subtitle="What your clients actually pay you in - changes the currency symbol throughout Reports, Revenue, Clients, and invoices">
        <div className="w-32">
          <CustomSelect
            value={currency}
            disabled={!isAdmin}
            onChange={(v) => { setCurrency(v as Currency); saveSettings({ currency: v as Currency }) }}
            options={CURRENCIES.map((c) => ({ value: c.value, label: c.label }))}
          />
        </div>
      </Row>
      <Row dataTour="rate-row" title="Target hourly rate" subtitle="What you want to realize per hour - compared against effective rate in Reports → Profitability and Revenue">
        <div className="flex items-center gap-1">
          <span className="text-xs w-14 text-right shrink-0">
            {rateStatus === 'saving' ? <span className="text-sage">Saving…</span> : rateStatus === 'saved' ? <span className="text-green">Saved ✓</span> : null}
          </span>
          <span className="text-sm text-sage">{currencySymbol(currency)}</span>
          <input
            type="number"
            min="0"
            step="1"
            className="w-20 rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
            value={hourlyCost}
            disabled={!isAdmin}
            onChange={(e) => onRateChange(e.target.value)}
            onBlur={() => saveSettings({})}
          />
          <span className="text-sm text-sage">/hr</span>
        </div>
      </Row>
      {saved && <div className="text-xs text-green mt-2">Saved</div>}
    </Section>
  )
}
