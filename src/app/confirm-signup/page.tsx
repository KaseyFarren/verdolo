'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Logo from '@/components/Logo'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-5 bg-cream text-ink">
      <div className="mb-2 flex justify-center">
        <Logo size={24} />
      </div>
      {children}
    </main>
  )
}

type Status = 'idle' | 'verifying' | 'invalid'

export default function ConfirmSignupPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('idle')

  // Same button-gated pattern as /accept-invite and /reset-password: verifying only ever runs
  // from this explicit click, never on page load, so an email security scanner's automatic
  // GET-fetch can't burn the single-use confirmation token before the real click happens.
  async function confirm() {
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
    } else if (tokenHash && otpType === 'signup') {
      const { data } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' })
      hasSession = !!data.session
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      hasSession = !!session
    }

    if (!hasSession) {
      window.history.replaceState(null, '', url.pathname)
      setStatus('invalid')
      return
    }

    router.push('/onboarding')
    router.refresh()
  }

  if (status === 'invalid') {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-center">This link is invalid or has expired</h1>
        <p className="text-sm text-sage text-center">Try signing up again to get a new confirmation link.</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-center">Confirm your email</h1>
      <p className="text-sm text-sage text-center">Click below to finish creating your Verdolo account.</p>
      <Button variant="primary" onClick={confirm} disabled={status === 'verifying'} className="w-full">
        {status === 'verifying' ? 'Confirming…' : 'Confirm email'}
      </Button>
    </Shell>
  )
}
