'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmProvider } from '@/components/ConfirmDialog'
import { PinLockProvider, usePinLock } from '@/components/PinLock'
import QuickCapture from '@/components/QuickCapture'
import TourProvider from '@/components/TourProvider'
import NotificationSound from '@/components/NotificationSound'
import BugReportModal from '@/components/BugReportModal'
import {
  BarChartIcon,
  CheckSquareIcon,
  ClockIcon,
  DollarSignIcon,
  FileIcon,
  HomeIcon,
  LockIcon,
  MenuIcon,
  MessageCircleIcon,
  SettingsIcon,
  UsersGroupIcon,
  UsersIcon,
} from '@/components/ui/icons'

const NAV = [
  { href: '/dashboard', icon: HomeIcon, label: 'Dashboard', tour: 'nav-dashboard' },
  { href: '/tasks', icon: CheckSquareIcon, label: 'Tasks' },
  { href: '/clients', icon: UsersIcon, label: 'Clients', tour: 'nav-clients' },
  { href: '/proposals', icon: FileIcon, label: 'Proposals', tour: 'nav-proposals' },
  { href: '/time', icon: ClockIcon, label: 'Time', tour: 'nav-time' },
  { href: '/messages', icon: MessageCircleIcon, label: 'Messages' },
  { href: '/reports', icon: BarChartIcon, label: 'Reports', adminOnly: true },
  { href: '/team', icon: UsersGroupIcon, label: 'Team', adminOnly: true },
  { href: '/revenue', icon: DollarSignIcon, label: 'Revenue', ownerOnly: true },
  { href: '/settings', icon: SettingsIcon, label: 'Settings', tour: 'nav-settings' },
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
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

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
          className="flex min-h-screen bg-cream text-ink"
          style={accentColor ? ({ '--accent': accentColor } as React.CSSProperties) : undefined}
        >
          <div className="md:hidden fixed top-0 inset-x-0 h-14 z-30 flex items-center justify-between px-4 bg-green text-cream shadow-md">
            <button
              id="mobile-nav-toggle"
              onClick={() => setMobileOpen(true)}
              className="leading-none"
              aria-label="Open menu"
            >
              <MenuIcon size={22} />
            </button>
            <div className="font-heading font-bold text-sm">{orgName}</div>
            <div className="w-6" />
          </div>

          <AnimatePresence>
            {mobileOpen && (
              <motion.div
                className="md:hidden fixed inset-0 bg-black/60 z-30"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setMobileOpen(false)}
              />
            )}
          </AnimatePresence>

          <div
            className={`fixed inset-y-0 left-0 w-52 bg-green text-cream flex flex-col z-40 transition-transform duration-200 md:translate-x-0 ${
              mobileOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="px-5 py-5 font-heading font-bold text-sm">{orgName}</div>
            <nav className="flex-1 flex flex-col gap-1 px-3">
              {NAV.filter((item) => (!item.adminOnly || isAdmin) && (!item.ownerOnly || role === 'owner')).map((item) => {
                const active = pathname?.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    // These routes have no loading.tsx and are fully dynamic (per-org RLS
                    // queries via headers()), so Next can't prefetch just a static shell - it
                    // runs the full page (org context + every Promise.all query) to prefetch
                    // at all. With the sidebar now a persistent layout instead of remounting
                    // per page, that fired for all ~10 routes on every navigation. Not worth
                    // the Supabase load for data that's stale again in seconds anyway.
                    prefetch={false}
                    data-tour={item.tour}
                    className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active ? 'text-white font-medium' : 'text-cream/70 hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-lg bg-white/10"
                        style={{ boxShadow: 'inset 2px 0 0 0 var(--accent)' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <item.icon size={17} className="relative shrink-0" />
                    <span className="relative">{item.label}</span>
                  </Link>
                )
              })}
            </nav>
            <div className="px-4 py-4 border-t border-cream/10">
              <div className="text-xs text-cream/50 truncate mb-2">{userEmail}</div>
              <div className="flex items-center gap-3">
                <button onClick={logout} className="text-xs text-cream/70 hover:text-white transition-colors">
                  Log out
                </button>
                <LockButton />
              </div>
              <div className="mt-2">
                <BugReportModal />
              </div>
              <div className="mt-2 flex gap-2 text-xs text-cream/40">
                <Link href="/terms" className="hover:text-cream/70">Terms</Link>
                <Link href="/privacy" className="hover:text-cream/70">Privacy</Link>
              </div>
            </div>
          </div>
          <div data-app-main className="md:ml-52 flex-1 min-w-0 min-h-screen pt-14 md:pt-0">
            <motion.div
              key={pathname}
              data-app-content
              className={`mx-auto px-4 md:px-6 py-6 md:py-8 ${
                pathname === '/tasks' || pathname === '/dashboard' || pathname === '/reports' || pathname === '/messages' || pathname === '/time' ? 'max-w-6xl' : 'max-w-3xl'
              }`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </div>
          <QuickCapture orgId={orgId} userId={userId} />
          <TourProvider orgId={orgId} role={role} />
          <NotificationSound orgId={orgId} userId={userId} />
        </div>
      </ConfirmProvider>
    </PinLockProvider>
  )
}

function LockButton() {
  const { hasPin, lock } = usePinLock()
  if (!hasPin) return null
  return (
    <button onClick={lock} title="Lock now" className="flex items-center gap-1 text-xs text-cream/70 hover:text-white transition-colors">
      <LockIcon size={12} /> Lock
    </button>
  )
}
