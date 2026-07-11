'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import CustomSelect from '@/components/ui/CustomSelect'

export default function InviteForm({ orgId, canInviteOwner }: { orgId: string; canInviteOwner: boolean }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin' | 'owner'>('member')
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')

    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, orgId, role }),
    })
    const body = await res.json()

    if (!res.ok) {
      toast.error(body.error ?? 'Invite failed')
      setStatus('idle')
      return
    }

    toast.success('Invite sent')
    setStatus('idle')
    setEmail('')
    router.refresh()
  }

  return (
    <section data-tour="invite-teammate">
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
        <div className="w-32">
          <CustomSelect
            value={role}
            onChange={(v) => setRole(v as 'member' | 'admin' | 'owner')}
            options={[
              { value: 'member', label: 'Member' },
              { value: 'admin', label: 'Admin' },
              ...(canInviteOwner ? [{ value: 'owner', label: 'Owner' }] : []),
            ]}
          />
        </div>
        <Button type="submit" variant="primary" disabled={status === 'loading'}>
          {status === 'loading' ? 'Sending…' : 'Invite'}
        </Button>
      </form>
    </section>
  )
}
