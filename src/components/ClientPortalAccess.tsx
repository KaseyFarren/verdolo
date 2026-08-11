'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'
import IconButton from '@/components/ui/IconButton'
import { PencilIcon, TrashIcon } from '@/components/ui/icons'

type ClientUser = { id: string; invited_email: string | null; display_name: string | null; status: string; created_at: string }

export default function ClientPortalAccess({ supabase, clientId }: { supabase: SupabaseClient; clientId: string }) {
  const [contacts, setContacts] = useState<ClientUser[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [inviting, setInviting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  useEffect(() => {
    supabase
      .from('client_users')
      .select('id, invited_email, display_name, status, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setContacts((data as ClientUser[]) ?? [])
      })
  }, [supabase, clientId])

  async function invite() {
    const trimmedEmail = email.trim()
    const trimmedName = name.trim()
    if (!trimmedEmail) return
    setInviting(true)
    const res = await fetch('/api/invite/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: trimmedEmail, clientId, name: trimmedName || undefined }),
    })
    const body = await res.json()
    setInviting(false)
    if (!res.ok) {
      toast.error(body.error || 'Could not send the invite')
      return
    }
    setContacts((prev) => [
      { id: crypto.randomUUID(), invited_email: trimmedEmail, display_name: trimmedName || null, status: 'invited', created_at: new Date().toISOString() },
      ...prev,
    ])
    setEmail('')
    setName('')
    toast.success('Invite sent')
  }

  async function revoke(contact: ClientUser) {
    setContacts((prev) => prev.filter((c) => c.id !== contact.id))
    const { error } = await supabase.from('client_users').delete().eq('id', contact.id)
    if (error) toast.error('Could not remove access')
  }

  async function saveName(contact: ClientUser) {
    const trimmed = editDraft.trim()
    setEditingId(null)
    setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, display_name: trimmed || null } : c)))
    const { error } = await supabase.from('client_users').update({ display_name: trimmed || null }).eq('id', contact.id)
    if (error) toast.error('Could not save that name')
  }

  return (
    <div>
      <div className="text-xs font-semibold tracking-wide text-sage mb-2">Portal access</div>
      <p className="text-xs text-sage mb-3">Invite a contact to log in and see this client&rsquo;s projects, tasks, files, and a shared message thread.</p>

      {contacts.length > 0 && (
        <div className="flex flex-col gap-1 mb-3">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md px-2 py-1.5 -mx-2 hover:bg-sand text-sm">
              {editingId === c.id ? (
                <input
                  autoFocus
                  className="flex-1 rounded border border-ink/10 bg-white px-2 py-1 text-sm mr-2"
                  placeholder="Contact name"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveName(c)}
                  onBlur={() => saveName(c)}
                />
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="truncate">{c.display_name || c.invited_email}</div>
                  {c.display_name && <div className="truncate text-xs text-sage">{c.invited_email}</div>}
                </div>
              )}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-sage capitalize">{c.status}</span>
                {editingId !== c.id && (
                  <IconButton
                    label="Edit name"
                    icon={<PencilIcon size={13} />}
                    onClick={() => {
                      setEditingId(c.id)
                      setEditDraft(c.display_name || '')
                    }}
                  />
                )}
                <IconButton label="Remove access" tone="red" icon={<TrashIcon size={13} />} onClick={() => revoke(c)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            className="w-32 rounded border border-ink/10 bg-white px-3 py-1.5 text-sm"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && invite()}
          />
          <input
            type="email"
            className="flex-1 rounded border border-ink/10 bg-white px-3 py-1.5 text-sm"
            placeholder="client@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && invite()}
          />
          <Button variant="secondary" size="sm" disabled={inviting || !email.trim()} onClick={invite}>
            {inviting ? 'Inviting…' : 'Invite'}
          </Button>
        </div>
      </div>
    </div>
  )
}
