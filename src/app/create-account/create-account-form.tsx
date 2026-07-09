'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Logo from '@/components/Logo'

type TokenStatus = 'pending' | 'claimed' | 'expired' | 'not_found'

const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 15000

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

export default function CreateAccountForm({
  sessionId,
  initialStatus,
  initialEmail,
}: {
  sessionId: string | null
  initialStatus: TokenStatus
  initialEmail: string | null
}) {
  const router = useRouter()
  const [status, setStatus] = useState<TokenStatus>(initialStatus)
  const [email, setEmail] = useState(initialEmail ?? '')
  const [polling, setPolling] = useState(initialStatus === 'not_found' && !!sessionId)
  const [orgName, setOrgName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const attempts = useRef(0)

  useEffect(() => {
    if (!polling || !sessionId) return
    const maxAttempts = Math.ceil(POLL_TIMEOUT_MS / POLL_INTERVAL_MS)
    const interval = setInterval(async () => {
      attempts.current += 1
      if (attempts.current > maxAttempts) {
        setPolling(false)
        setStatus('not_found')
        return
      }
      const res = await fetch(`/api/create-account/lookup?session_id=${encodeURIComponent(sessionId)}`)
      const data = await res.json()
      if (data.status === 'pending' || data.status === 'claimed' || data.status === 'expired') {
        setStatus(data.status)
        if (data.email) setEmail(data.email)
        setPolling(false)
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [polling, sessionId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError) {
      toast.error(signUpError.message)
      setLoading(false)
      return
    }
    if (!data.session) {
      toast.error('Check your email to confirm your account, then come back to this link to finish setup.')
      setLoading(false)
      return
    }

    const { error: claimError } = await supabase.rpc('claim_purchase_token', {
      p_session_id: sessionId,
      p_org_name: orgName,
    })
    if (claimError) {
      toast.error('This link is no longer valid. Contact support to finish setting up your account.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  if (polling) {
    return (
      <Shell>
        <p className="text-sm text-sage text-center">Finishing up your purchase...</p>
      </Shell>
    )
  }

  if (status === 'claimed') {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-center">Account already created</h1>
        <p className="text-sm text-sage text-center">You&apos;ve already created an account for this purchase - log in instead.</p>
        <Link href="/login" className="text-sm underline hover:text-sage text-center">
          Log in
        </Link>
      </Shell>
    )
  }

  if (status === 'expired' || status === 'not_found') {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-center">This link is invalid</h1>
        <p className="text-sm text-sage text-center">
          {status === 'expired'
            ? 'This link has expired. Contact support to finish setting up your account.'
            : "We couldn't find a purchase matching this link. Contact support if you believe this is a mistake."}
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-center">Set up your agency</h1>
      <p className="text-sm text-sage text-center">Thanks for your purchase - let&apos;s get your account set up.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          value={email}
          readOnly
          className="rounded border border-ink/10 bg-sand px-3 py-2 text-sm text-sage"
        />
        <input
          type="text"
          placeholder="Agency name"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          required
          className="rounded border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          type="password"
          placeholder="Password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <Button type="submit" variant="primary" disabled={loading} className="w-full">
          {loading ? 'Setting up...' : 'Create account'}
        </Button>
      </form>
    </Shell>
  )
}
