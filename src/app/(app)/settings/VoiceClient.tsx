'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Section } from '@/components/settings/SettingsUI'

type Settings = {
  eod_hour?: number
  exclude_weekends?: boolean
  notifications?: boolean
  brand_voice?: string
}

export default function VoiceClient({ orgId, isAdmin, settings }: { orgId: string; isAdmin: boolean; settings: Settings }) {
  const supabase = useMemo(() => createClient(), [])
  const [brandVoice, setBrandVoice] = useState(settings.brand_voice ?? '')
  const [saved, setSaved] = useState(false)

  async function save() {
    if (!isAdmin) return
    // See GeneralClient's saveSettings comment: the `settings` prop is stale after a sibling tab
    // writes in the same client session, so re-read before merging to avoid clobbering it.
    const { data: fresh } = await supabase.from('orgs').select('settings').eq('id', orgId).single()
    await supabase.from('orgs').update({ settings: { ...settings, ...(fresh?.settings ?? {}), brand_voice: brandVoice.trim() } }).eq('id', orgId)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  if (!isAdmin) {
    return <div className="text-sm text-sage">Only admins can change voice & tone settings.</div>
  }

  return (
    <Section label="Voice & Tone">
      <div className="text-sm font-medium">Brand voice</div>
      <div className="text-xs text-sage mt-0.5 mb-2">
        Describe how your agency should sound - this guides every AI-generated weekly recap and client message.
      </div>
      <textarea
        className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm min-h-[110px]"
        placeholder="e.g. Warm and direct, no corporate jargon. Short sentences. Confident but never salesy."
        value={brandVoice}
        onChange={(e) => setBrandVoice(e.target.value)}
        onBlur={save}
      />
      {saved && <div className="text-xs text-green mt-2">Saved</div>}
    </Section>
  )
}
