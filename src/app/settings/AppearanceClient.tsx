'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Row, Section } from '@/components/settings/SettingsUI'

const ACCENT_PRESETS = ['#dd6b2c', '#1f3320', '#e98a4f', '#5d6b5c', '#c9973c', '#8a6a3c']

export default function AppearanceClient({
  orgId,
  isAdmin,
  initialAccentColor,
}: {
  orgId: string
  isAdmin: boolean
  initialAccentColor: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [accentColor, setAccentColor] = useState(initialAccentColor)

  async function saveAccentColor(color: string) {
    if (!isAdmin) return
    setAccentColor(color)
    await supabase.from('orgs').update({ accent_color: color }).eq('id', orgId)
    router.refresh()
    toast.success('Accent color updated')
  }

  if (!isAdmin) {
    return <div className="text-sm text-sage">Only admins can change appearance settings.</div>
  }

  return (
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
  )
}
