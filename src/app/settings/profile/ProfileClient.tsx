'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Row, Section } from '@/components/settings/SettingsUI'
import { getInitials } from '@/lib/agency'

export default function ProfileClient({
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
