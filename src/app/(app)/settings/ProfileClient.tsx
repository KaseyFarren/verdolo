'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Row, Section } from '@/components/settings/SettingsUI'
import { AVATAR_COLORS, getInitials } from '@/lib/agency'
import { startTourReplay, tourReplayKey, tourStepKey } from '@/lib/tour'

const MAX_AVATAR_BYTES = 3 * 1024 * 1024

export default function ProfileClient({
  orgId,
  userId,
  initialDisplayName,
  initialAvatarUrl,
  canTestOnboarding = false,
}: {
  orgId: string
  userId: string
  initialDisplayName: string
  initialAvatarUrl: string | null
  canTestOnboarding?: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl)
  const [nameStatus, setNameStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const nameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default')

  useEffect(() => {
    setNotifPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  }, [])

  async function enableDesktopNotifications() {
    if (typeof Notification === 'undefined') return
    // requestPermission must run from a user gesture (this click) - it can't be requested
    // passively when a notification-worthy event arrives.
    const result = await Notification.requestPermission()
    setNotifPermission(result)
    if (result === 'granted') {
      new Notification('Desktop notifications on', { body: "You'll be notified about mentions and new tasks.", icon: '/icon.png' })
    } else if (result === 'denied') {
      toast.error('Blocked - allow notifications for this site in your browser settings')
    }
  }

  const [testingOnboarding, setTestingOnboarding] = useState(false)
  async function testOnboarding() {
    setTestingOnboarding(true)
    const res = await fetch('/api/onboarding/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Could not reset onboarding' }))
      toast.error(error || 'Could not reset onboarding')
      setTestingOnboarding(false)
      return
    }
    // Clear any leftover tour progress so the auto first-run tour starts clean from step 0, then
    // land on the dashboard where TourProvider auto-fires it (owner + no completion timestamp).
    localStorage.removeItem(tourStepKey(orgId))
    localStorage.removeItem(tourReplayKey(orgId))
    window.location.assign('/dashboard')
  }

  // Save as the user types (debounced) as well as on blur, so they get a clear "Saved" without
  // having to click off the field first - and see "Saving…/Saved ✓" the whole time.
  async function saveDisplayName(value = displayName) {
    setNameStatus('saving')
    await supabase.from('org_members').update({ display_name: value.trim() || null }).eq('org_id', orgId).eq('user_id', userId)
    setNameStatus('saved')
    setTimeout(() => setNameStatus((s) => (s === 'saved' ? 'idle' : s)), 2000)
  }

  function onNameChange(value: string) {
    setDisplayName(value)
    setNameStatus('saving')
    if (nameDebounce.current) clearTimeout(nameDebounce.current)
    nameDebounce.current = setTimeout(() => saveDisplayName(value), 700)
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
    // Upload goes through /api/avatar (service-role, server-side) rather than straight to storage:
    // the avatars-bucket RLS insert policy has never reliably landed in prod, so a direct browser
    // upload fails with "new row violates row-level security policy". See the route for detail.
    const body = new FormData()
    body.append('file', file)
    let res: Response
    try {
      res = await fetch('/api/avatar', { method: 'POST', body })
    } catch {
      toast.error('Upload failed - check your connection and try again')
      setUploading(false)
      return
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(json.error || 'Upload failed - try again')
      setUploading(false)
      return
    }
    setAvatarUrl(json.url)
    setUploading(false)
    toast.success('Profile picture updated')
    router.refresh()
  }

  async function removeAvatar() {
    setUploading(true)
    let res: Response
    try {
      res = await fetch('/api/avatar', { method: 'DELETE' })
    } catch {
      toast.error('Could not remove your picture - try again')
      setUploading(false)
      return
    }
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      toast.error(json.error || 'Could not remove your picture')
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
      <Row title="Desktop notifications" subtitle="Get a browser popup for @mentions and tasks assigned to you, even in another tab">
        {notifPermission === 'unsupported' ? (
          <span className="text-xs text-sage">Not supported in this browser</span>
        ) : notifPermission === 'granted' ? (
          <span className="text-xs text-green">Enabled</span>
        ) : notifPermission === 'denied' ? (
          <span className="text-xs text-sage">Blocked - enable in your browser&apos;s site settings</span>
        ) : (
          <button className="rounded border border-ink/10 bg-white px-3 py-1.5 text-sm hover:bg-sand/60" onClick={enableDesktopNotifications}>
            Enable
          </button>
        )}
      </Row>
      <Row title="Nickname" subtitle="Shown instead of your email across the app">
        <div className="flex items-center gap-2">
          <input
            data-tour="display-name"
            className="rounded border border-ink/10 bg-white px-2 py-1.5 text-sm w-40"
            placeholder="Your name"
            value={displayName}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={() => saveDisplayName()}
          />
          <span className="text-xs w-14 shrink-0">
            {nameStatus === 'saving' ? <span className="text-sage">Saving…</span> : nameStatus === 'saved' ? <span className="text-green">Saved ✓</span> : null}
          </span>
        </div>
      </Row>
      <Row title="Guided tour" subtitle="Replay the walkthrough of where to enter your info, tailored to your role">
        <button
          className="rounded border border-ink/10 bg-white px-3 py-1.5 text-sm hover:bg-sand/60"
          onClick={() => startTourReplay(orgId)}
        >
          Replay tour
        </button>
      </Row>
      {canTestOnboarding && (
        <Row
          title="Test onboarding"
          subtitle="Reset first-run state so the new-owner tour auto-fires on the dashboard, exactly as a brand-new owner sees it - visible only on your account"
        >
          <button
            className="rounded border border-ink/10 bg-white px-3 py-1.5 text-sm hover:bg-sand/60 disabled:opacity-50"
            disabled={testingOnboarding}
            onClick={testOnboarding}
          >
            {testingOnboarding ? 'Resetting…' : 'Test onboarding'}
          </button>
        </Row>
      )}
    </Section>
  )
}

function hashCode(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return h
}
