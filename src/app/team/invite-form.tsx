'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'

export default function InviteForm({ orgId, canInviteOwner }: { orgId: string; canInviteOwner: boolean }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin' | 'owner'>('member')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setError(null)

    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, orgId, role }),
    })
    const body = await res.json()

    if (!res.ok) {
      setError(body.error ?? 'Invite failed')
      setStatus('error')
      return
    }

    setStatus('sent')
    setEmail('')
    router.refresh()
  }

  return (
    <section>
      <h2 className="mb-2 font-medium text-ink">Invite a teammate</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          placeholder="teammate@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="flex-1 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'member' | 'admin' | 'owner')}
          className="rounded-lg border border-ink/15 bg-white px-2 py-2 text-sm"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          {canInviteOwner && <option value="owner">Owner</option>}
        </select>
        <Button type="submit" variant="primary" disabled={status === 'loading'}>
          {status === 'loading' ? 'Sending…' : 'Invite'}
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {status === 'sent' && <p className="mt-2 text-sm text-green">Invite sent.</p>}
    </section>
  )
}
