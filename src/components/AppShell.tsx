'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmProvider } from '@/components/ConfirmDialog'
import { PinLockProvider, usePinLock } from '@/components/PinLock'
import QuickCapture from '@/components/QuickCapture'

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
  orgId,
  userId,
  orgName,
  userEmail,
  role,
  accentColor,
  children,
}: {
  orgId: string
  userId: string
  orgName: string
  userEmail: string
  role?: 'owner' | 'admin' | 'member'
  accentColor?: string | null
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
    <PinLockProvider>
      <ConfirmProvider>
        <div
          className="flex min-h-screen bg-neutral-950 text-neutral-100"
          style={accentColor ? ({ '--accent': accentColor } as React.CSSProperties) : undefined}
        >
          <div className="fixed inset-y-0 left-0 w-48 border-r border-white/10 bg-neutral-900/60 flex flex-col">
            <div className="px-4 py-4 font-semibold text-sm">{orgName}</div>
            <nav className="flex-1 flex flex-col gap-1 px-2">
              {NAV.filter((item) => (!item.adminOnly || isAdmin) && (!item.ownerOnly || role === 'owner')).map((item) => {
                const active = pathname?.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                      active ? 'text-white font-medium' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-md bg-white/10"
                        style={{ boxShadow: 'inset 2px 0 0 0 var(--accent)' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span className="relative">{item.icon}</span>
                    <span className="relative">{item.label}</span>
                  </Link>
                )
              })}
            </nav>
            <div className="px-3 py-3 border-t border-white/10">
              <div className="text-xs text-neutral-500 truncate mb-2">{userEmail}</div>
              <div className="flex items-center gap-3">
                <button onClick={logout} className="text-xs text-neutral-400 hover:text-white transition-colors">
                  Log out
                </button>
                <LockButton />
              </div>
              <div className="mt-2 flex gap-2 text-[10px] text-neutral-600">
                <Link href="/terms" className="hover:text-neutral-400">Terms</Link>
                <Link href="/privacy" className="hover:text-neutral-400">Privacy</Link>
              </div>
            </div>
          </div>
          <div className="ml-48 flex-1 min-h-screen">
            <motion.div
              key={pathname}
              className="max-w-3xl mx-auto px-6 py-8"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </div>
          <QuickCapture orgId={orgId} userId={userId} />
        </div>
      </ConfirmProvider>
    </PinLockProvider>
  )
}

function LockButton() {
  const { hasPin, lock } = usePinLock()
  if (!hasPin) return null
  return (
    <button onClick={lock} title="Lock now" className="text-xs text-neutral-400 hover:text-white transition-colors">
      🔒 Lock
    </button>
  )
}
