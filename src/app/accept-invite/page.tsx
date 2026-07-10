'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Logo from '@/components/Logo'

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

export default function AcceptInvitePage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Supabase's invite link can deliver the session in more than one shape depending on flow
    // type/template config - a PKCE `?code=`, a `?token_hash=&type=` pair (the newer confirm-link
    // style), or plain hash-fragment tokens the browser client auto-detects on load. Handling
    // only one of these silently showed "invalid or expired" even when Supabase's own Auth logs
    // confirmed the /verify call and Login had already succeeded server-side - the session was
    // real, this page just wasn't picking it up. This all has to run client-side (hash fragments
    // never reach the server), which is why the route bypasses the server-side auth check
    // entirely (see PUBLIC_PATHS in lib/supabase/middleware.ts) rather than being a normal page.
    const supabase = createClient()

    async function resolveSession() {
      const url = new URL(window.location.href)
      const code = url.searchParams.get('code')
      const tokenHash = url.searchParams.get('token_hash')
      const otpType = url.searchParams.get('type')
      const knownOtpTypes = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const

      if (code) {
        await supabase.auth.exchangeCodeForSession(code)
      } else if (tokenHash && otpType && (knownOtpTypes as readonly string[]).includes(otpType)) {
        await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType as (typeof knownOtpTypes)[number] })
      }

      if (code || tokenHash) window.history.replaceState(null, '', url.pathname)

      const {
        data: { session },
      } = await supabase.auth.getSession()
      setEmail(session?.user?.email ?? null)
      setChecking(false)
    }

    resolveSession()
  }, [])

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
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  if (checking) {
    return (
      <Shell>
        <p className="text-sm text-sage text-center">Loading…</p>
      </Shell>
    )
  }

  if (!email) {
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
