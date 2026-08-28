'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'

export default function AcceptForm({ token }: { token: string }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState<string | null>(null)

  async function accept() {
    if (!name.trim()) return
    setBusy(true)
    const res = await fetch('/api/proposal/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name: name.trim() }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      toast.error(body?.error || 'Could not accept this proposal')
      return
    }
    setAccepted(name.trim())
  }

  if (accepted) {
    return <div className="text-sm text-green font-medium">Thanks, {accepted} - this proposal is now accepted.</div>
  }

  return (
    <div className="no-print flex flex-col sm:flex-row gap-2">
      <input
        className="flex-1 rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
        placeholder="Type your full name to accept"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button variant="primary" onClick={accept} disabled={busy || !name.trim()}>
        {busy ? 'Accepting…' : 'Accept proposal'}
      </Button>
    </div>
  )
}
