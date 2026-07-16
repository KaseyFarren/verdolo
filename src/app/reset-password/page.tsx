'use client'

import { useState } from 'react'
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

type Status = 'idle' | 'verifying' | 'ready' | 'invalid'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('idle')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  // Same button-gated pattern as /accept-invite: verifying only ever runs from this explicit
  // click, never on page load, so an email security scanner's automatic GET-fetch can't burn
  // the single-use recovery token before the real click happens.
  async function verify() {
    setStatus('verifying')
    const supabase = createClient()
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    const tokenHash = url.searchParams.get('token_hash')
    const otpType = url.searchParams.get('type')

    let hasSession = false
    if (code) {
      const { data } = await supabase.auth.exchangeCodeForSession(code)
      hasSession = !!data.session
    } else if (tokenHash && otpType === 'recovery') {
      const { data } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      hasSession = !!data.session
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      hasSession = !!session
    }

    window.history.replaceState(null, '', url.pathname)
    setStatus(hasSession ? 'ready' : 'invalid')
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
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    router.push('/')
    router.refresh()
  }

  if (status === 'idle') {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-center">Reset your password</h1>
        <p className="text-sm text-sage text-center">Click below to continue.</p>
        <Button variant="primary" onClick={verify} className="w-full">
          Continue
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

  if (status === 'invalid') {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-center">This link is invalid or has expired</h1>
        <p className="text-sm text-sage text-center">Request a new password reset link and try again.</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-center">Choose a new password</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          placeholder="New password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          type="password"
          placeholder="Confirm new password"
          minLength={6}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          className="rounded border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <Button type="submit" variant="primary" disabled={saving} className="w-full">
          {saving ? 'Saving…' : 'Reset password'}
        </Button>
      </form>
    </Shell>
  )
}
