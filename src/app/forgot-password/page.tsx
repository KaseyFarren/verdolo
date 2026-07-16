'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Logo from '@/components/Logo'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    // Always show the same "sent" state regardless of whether the email exists - avoids
    // leaking which addresses have Verdolo accounts.
    if (error) {
      toast.error(error.message)
      return
    }
    setSent(true)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4 bg-cream text-ink">
      <div className="mb-2 flex justify-center">
        <Logo size={24} />
      </div>
      {sent ? (
        <>
          <h1 className="text-xl font-semibold text-center">Check your email</h1>
          <p className="text-sm text-sage text-center">
            If an account exists for {email}, we sent a link to reset your password.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold text-center">Reset your password</h1>
          <p className="text-sm text-sage text-center">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button type="submit" variant="primary" disabled={loading} className="w-full">
              {loading ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
        </>
      )}
      <p className="text-sm text-sage text-center">
        <Link href="/login" className="underline hover:text-sage">
          Back to login
        </Link>
      </p>
    </main>
  )
}
