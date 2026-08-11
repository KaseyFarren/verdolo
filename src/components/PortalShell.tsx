'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import Logo from '@/components/Logo'
import Button from '@/components/ui/Button'
import { PencilIcon } from '@/components/ui/icons'

const TABS = [
  { href: '/portal', label: 'Projects' },
  { href: '/portal/files', label: 'Files' },
  { href: '/portal/messages', label: 'Messages' },
]

function ContactName({ contactName }: { contactName: string | null }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(contactName ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    const trimmed = name.trim()
    setSaving(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase.from('client_users').update({ display_name: trimmed || null }).eq('user_id', user?.id)
    setSaving(false)
    setEditing(false)
    if (error) toast.error('Could not save your name')
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="w-32 rounded border border-ink/10 bg-white px-2 py-1 text-sm"
        placeholder="Your name"
        value={name}
        disabled={saving}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        onBlur={save}
      />
    )
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 text-sm text-sage hover:text-ink">
      {contactName || 'Add your name'}
      <PencilIcon size={11} />
    </button>
  )
}

// Deliberately thin next to AppShell - no team nav, no billing/revenue/admin routes exist
// under /portal at all, so there's nothing to gate beyond the client_users RLS scoping
// already done at the data layer.
export default function PortalShell({ clientName, contactName, children }: { clientName: string; contactName: string | null; children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-cream text-ink">
      <header className="flex items-center justify-between px-5 sm:px-8 py-4 border-b border-ink/8 bg-white">
        <Logo size={20} />
        <div className="flex items-center gap-3">
          <ContactName contactName={contactName} />
          <span className="text-ink/15">·</span>
          <span className="text-sm text-sage">{clientName}</span>
          <Button variant="secondary" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </header>
      <nav className="flex items-center gap-1 px-5 sm:px-8 pt-4 max-w-4xl mx-auto">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${pathname === tab.href ? 'bg-white shadow-sm text-ink' : 'text-sage hover:text-ink'}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <main className="max-w-4xl mx-auto p-4 sm:p-6">{children}</main>
    </div>
  )
}
