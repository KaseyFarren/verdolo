'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const NAV = [
  { href: '/dashboard', icon: '🏠', label: 'Dashboard' },
  { href: '/tasks', icon: '✅', label: 'Tasks' },
  { href: '/calendar', icon: '📅', label: 'Calendar' },
  { href: '/clients', icon: '👥', label: 'Clients' },
  { href: '/time', icon: '⏱️', label: 'Time' },
  { href: '/team', icon: '🧑‍🤝‍🧑', label: 'Team', adminOnly: true },
  { href: '/billing', icon: '💳', label: 'Billing', ownerOnly: true },
  { href: '/settings', icon: '⚙️', label: 'Settings' },
]

export default function AppShell({
  orgName,
  userEmail,
  role,
  children,
}: {
  orgName: string
  userEmail: string
  role?: 'owner' | 'admin' | 'member'
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const isAdmin = role === 'owner' || role === 'admin'

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <div className="fixed inset-y-0 left-0 w-48 border-r border-white/10 bg-neutral-900/60 flex flex-col">
        <div className="px-4 py-4 font-semibold text-sm">{orgName}</div>
        <nav className="flex-1 flex flex-col gap-1 px-2">
          {NAV.filter((item) => (!item.adminOnly || isAdmin) && (!item.ownerOnly || role === 'owner')).map((item) => {
            const active = pathname?.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  active ? 'bg-white/10 text-white font-medium' : 'text-neutral-400 hover:text-white'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="px-3 py-3 border-t border-white/10">
          <div className="text-xs text-neutral-500 truncate mb-2">{userEmail}</div>
          <button onClick={logout} className="text-xs text-neutral-400 hover:text-white">
            Log out
          </button>
          <div className="mt-2 flex gap-2 text-[10px] text-neutral-600">
            <Link href="/terms" className="hover:text-neutral-400">Terms</Link>
            <Link href="/privacy" className="hover:text-neutral-400">Privacy</Link>
          </div>
        </div>
      </div>
      <div className="ml-48 flex-1 min-h-screen">
        <div className="max-w-3xl mx-auto px-6 py-8">{children}</div>
      </div>
    </div>
  )
}
