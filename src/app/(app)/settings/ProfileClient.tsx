'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Row, Section } from '@/components/settings/SettingsUI'
import { AVATAR_COLORS, getInitials } from '@/lib/agency'

const MAX_AVATAR_BYTES = 3 * 1024 * 1024

export default function ProfileClient({
  orgId,
  userId,
  initialDisplayName,
  initialAvatarUrl,
}: {
  orgId: string
  userId: string
  initialDisplayName: string
  initialAvatarUrl: string | null
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function saveDisplayName() {
    await supabase.from('org_members').update({ display_name: displayName.trim() || null }).eq('org_id', orgId).eq('user_id', userId)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Image must be under 3MB')
      return
    }
    setUploading(true)
    // Folder must be the user's id - storage RLS (migration 0022) only lets you write under
    // avatars/<your-uid>/. upsert overwrites the previous file so old pictures don't pile up.
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `${userId}/avatar.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) {
      toast.error('Upload failed - try again')
      setUploading(false)
      return
    }
    // Bucket is public; add a cache-busting query so the new picture shows immediately even
    // though the storage path (and thus base URL) is stable across re-uploads.
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = `${pub.publicUrl}?t=${Date.now()}`
    const { error: updErr } = await supabase.from('org_members').update({ avatar_url: url }).eq('org_id', orgId).eq('user_id', userId)
    if (updErr) {
      toast.error('Could not save your picture')
      setUploading(false)
      return
    }
    setAvatarUrl(url)
    setUploading(false)
    toast.success('Profile picture updated')
    router.refresh()
  }

  async function removeAvatar() {
    setUploading(true)
    const { error } = await supabase.from('org_members').update({ avatar_url: null }).eq('org_id', orgId).eq('user_id', userId)
    if (error) {
      toast.error('Could not remove your picture')
      setUploading(false)
      return
    }
    setAvatarUrl(null)
    setUploading(false)
    router.refresh()
  }

  const initials = getInitials(displayName || 'You')
  const colorIndex = Math.abs(hashCode(userId)) % AVATAR_COLORS.length

  return (
    <Section label="Profile">
      <Row title="Profile picture" subtitle="Shown next to your name across tasks, messages and the team">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="Your profile picture" className="h-14 w-14 rounded-full object-cover shrink-0" />
          ) : (
            <div
              className="h-14 w-14 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0"
              style={{ background: AVATAR_COLORS[colorIndex] }}
            >
              {initials}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadAvatar(file)
                e.target.value = ''
              }}
            />
            <button
              className="rounded border border-ink/10 bg-white px-3 py-1.5 text-sm hover:bg-sand/60 disabled:opacity-50"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? 'Uploading…' : avatarUrl ? 'Change' : 'Upload'}
            </button>
            {avatarUrl && (
              <button className="text-sm text-red-600 hover:underline disabled:opacity-50" disabled={uploading} onClick={removeAvatar}>
                Remove
              </button>
            )}
          </div>
        </div>
      </Row>
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

function hashCode(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return h
}
