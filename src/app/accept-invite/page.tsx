'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Logo from '@/components/Logo'

const KNOWN_OTP_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4 bg-cream text-ink">
      <div className="mb-2 flex justify-center">
        <Logo size={24} />
      </div>
      {children}
    </main>
  )
}

type Status = 'idle' | 'verifying' | 'ready' | 'invalid'

export default function AcceptInvitePage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('idle')
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  // Verification only ever runs from this explicit click, never on page load. Email security
  // scanners (Gmail, Outlook Safe Links, Apple Mail Privacy Protection, etc.) automatically
  // GET-fetch links in emails to scan them - if this page auto-verified on mount, that scan
  // alone would burn the single-use invite token before the person ever saw the page, so every
  // real click landed on an already-consumed link. Confirmed via Supabase's own Auth logs: two
  // /verify calls at the identical second, one "request completed" and one "invalid or has
  // expired" - a scanner and the real click racing for the same token. Gating verification
  // behind a manual button press means the scanner's GET is harmless (nothing to verify yet).
  async function acceptInvite() {
    setStatus('verifying')
    const supabase = createClient()
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    const tokenHash = url.searchParams.get('token_hash')
    const otpType = url.searchParams.get('type')

    let sessionEmail: string | null = null
    let sessionUserId: string | null = null

    if (code) {
      const { data } = await supabase.auth.exchangeCodeForSession(code)
      sessionEmail = data.session?.user?.email ?? null
      sessionUserId = data.session?.user?.id ?? null
    } else if (tokenHash && otpType && (KNOWN_OTP_TYPES as readonly string[]).includes(otpType)) {
      const { data } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType as (typeof KNOWN_OTP_TYPES)[number] })
      sessionEmail = data.session?.user?.email ?? null
      sessionUserId = data.session?.user?.id ?? null
    } else {
      // Fallback for the old-style link format (hash-fragment tokens the browser client
      // auto-detects), in case an email sent before this change is still being used.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      sessionEmail = session?.user?.email ?? null
      sessionUserId = session?.user?.id ?? null
    }

    // A session existing isn't proof of a real invite - anyone already logged in (e.g. from an
    // unrelated tab) who lands on this bare URL would otherwise get a "set a new password" form
    // that silently changes their real account's password under the guise of "finishing setup".
    // Require an actual pending 'invited' org_members row for this user before proceeding.
    // org_members_select requires status='active' (is_org_member), so a direct table query
    // can't see an 'invited' row even for the legitimate invitee - has_pending_invite() is a
    // narrow security-definer RPC scoped to auth.uid() that sidesteps that.
    let hasPendingInvite = false
    if (sessionUserId) {
      const { data } = await supabase.rpc('has_pending_invite')
      hasPendingInvite = data === true
    }

    window.history.replaceState(null, '', url.pathname)
    setEmail(sessionEmail)
    setStatus(sessionEmail && hasPendingInvite ? 'ready' : 'invalid')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Passwords don’t match')
      return
    }
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setSaving(false)
      toast.error(error.message)
      return
    }
    // Flips this user's org_members row from 'invited' to 'active' now that setup is actually
    // complete - before this, they didn't count against the org's seat limit or show up in
    // member pickers.
    await supabase.rpc('accept_own_invite')
    setSaving(false)
    router.push('/dashboard')
    router.refresh()
  }

  if (status === 'idle') {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-center">You&apos;ve been invited to Verdolo</h1>
        <p className="text-sm text-sage text-center">Click below to accept your invite and set up your account.</p>
        <Button variant="primary" onClick={acceptInvite} className="w-full">
          Accept invite
        </Button>
      </Shell>
    )
  }

  if (status === 'verifying') {
    return (
      <Shell>
        <p className="text-sm text-sage text-center">Verifying…</p>
      </Shell>
    )
  }

  if (status === 'invalid' || !email) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-center">This invite link is invalid or has expired</h1>
        <p className="text-sm text-sage text-center">Ask whoever invited you to send a new one.</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-center">Set up your account</h1>
      <p className="text-sm text-sage text-center">You&apos;ve been invited to join a team on Verdolo. Choose a password to finish joining.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input type="email" value={email} readOnly className="rounded border border-ink/10 bg-sand px-3 py-2 text-sm text-sage" />
        <input
          type="password"
          placeholder="Choose a password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          type="password"
          placeholder="Confirm password"
          minLength={6}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          className="rounded border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <Button type="submit" variant="primary" disabled={saving} className="w-full">
          {saving ? 'Setting up…' : 'Finish setup'}
        </Button>
      </form>
    </Shell>
  )
}
