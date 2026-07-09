'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Logo from '@/components/Logo'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [checkEmail, setCheckEmail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [agreed, setAgreed] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed) {
      toast.error('Please agree to the Terms of Service and Privacy Policy to continue.')
      return
    }
    setLoading(true)

    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    if (!data.session) {
      // email confirmation is required before a session exists
      setCheckEmail(true)
      setLoading(false)
      return
    }

    router.push('/onboarding')
    router.refresh()
  }

  if (checkEmail) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4 bg-cream text-ink">
        <div className="mb-2 flex justify-center">
          <Logo size={24} />
        </div>
        <h1 className="text-xl font-semibold text-center">Check your email</h1>
        <p className="text-sm text-sage">
          We sent a confirmation link to {email}. Click it, then come back and log in.
        </p>
        <Link href="/login" className="underline hover:text-sage">
          Back to login
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4 bg-cream text-ink">
      <div className="mb-2 flex justify-center">
        <Logo size={24} />
      </div>
      <h1 className="text-xl font-semibold text-center">Create your account</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
        <label className="flex items-start gap-2 text-xs text-sage">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" target="_blank" className="underline hover:text-sage">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="underline hover:text-sage">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <Button type="submit" variant="primary" disabled={loading} className="w-full">
          {loading ? 'Creating…' : 'Sign up'}
        </Button>
      </form>
      <p className="text-sm text-sage">
        Already have an account?{' '}
        <Link href="/login" className="underline hover:text-sage">
          Log in
        </Link>
      </p>
    </main>
  )
}
