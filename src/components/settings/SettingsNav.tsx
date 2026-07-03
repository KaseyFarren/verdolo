'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/settings', label: 'General' },
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/appearance', label: 'Appearance', adminOnly: true },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/security', label: 'Security' },
  { href: '/settings/data', label: 'Data' },
  { href: '/settings/billing', label: 'Billing', ownerOnly: true },
]

export default function SettingsNav({ role }: { role: 'owner' | 'admin' | 'member' }) {
  const pathname = usePathname()
  const isAdmin = role === 'owner' || role === 'admin'

  return (
    <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible md:w-44 shrink-0 mb-4 md:mb-0">
      {NAV.filter((item) => (!item.adminOnly || isAdmin) && (!item.ownerOnly || role === 'owner')).map((item) => {
        const active = item.href === '/settings' ? pathname === '/settings' : pathname?.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              active ? 'bg-white shadow-md font-medium text-ink' : 'text-sage hover:text-ink hover:bg-sand'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
