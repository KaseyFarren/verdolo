'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Logo from '@/components/Logo'
import Button from '@/components/ui/Button'

const TABS = [
  { href: '/portal', label: 'Projects' },
  { href: '/portal/files', label: 'Files' },
  { href: '/portal/messages', label: 'Messages' },
]

// Deliberately thin next to AppShell - no team nav, no billing/revenue/admin routes exist
// under /portal at all, so there's nothing to gate beyond the client_users RLS scoping
// already done at the data layer.
export default function PortalShell({ clientName, children }: { clientName: string; children: React.ReactNode }) {
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
