'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Row, Section } from '@/components/settings/SettingsUI'

export default function ProfileClient({
  orgId,
  userId,
  initialDisplayName,
}: {
  orgId: string
  userId: string
  initialDisplayName: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [saved, setSaved] = useState(false)

  async function saveDisplayName() {
    await supabase.from('org_members').update({ display_name: displayName.trim() || null }).eq('org_id', orgId).eq('user_id', userId)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
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
    </Section>
  )
}
