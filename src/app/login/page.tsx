'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4 bg-neutral-950 text-neutral-100">
      <h1 className="text-xl font-semibold">Log in</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded border border-white/10 bg-black/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded border border-white/10 bg-black/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" variant="primary" disabled={loading} className="w-full">
          {loading ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <p className="text-sm text-neutral-500">
        No account?{' '}
        <Link href="/signup" className="underline hover:text-neutral-300">
          Create one
        </Link>
      </p>
    </main>
  )
}
