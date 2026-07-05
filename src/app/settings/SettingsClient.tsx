'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import GeneralClient from './GeneralClient'
import ProfileClient from './ProfileClient'
import AppearanceClient from './AppearanceClient'
import VoiceClient from './VoiceClient'
import IntegrationsClient from './IntegrationsClient'
import SecurityClient from './SecurityClient'
import DataClient from './DataClient'
import BillingClient from './BillingClient'

type View = 'general' | 'profile' | 'appearance' | 'voice' | 'integrations' | 'security' | 'data' | 'billing'
type Role = 'owner' | 'admin' | 'member'
type Status = 'trialing' | 'active' | 'past_due' | 'canceled' | null
type Settings = {
  eod_hour?: number
  exclude_weekends?: boolean
  notifications?: boolean
  brand_voice?: string
}

const NAV: { value: View; label: string; adminOnly?: boolean; ownerOnly?: boolean }[] = [
  { value: 'general', label: 'General' },
  { value: 'profile', label: 'Profile' },
  { value: 'appearance', label: 'Appearance', adminOnly: true },
  { value: 'voice', label: 'Voice & Tone', adminOnly: true },
  { value: 'integrations', label: 'Integrations' },
  { value: 'security', label: 'Security' },
  { value: 'data', label: 'Data' },
  { value: 'billing', label: 'Billing', ownerOnly: true },
]

export default function SettingsClient({
  orgId,
  userId,
  role,
  isAdmin,
  settings,
  initialAccentColor,
  initialDisplayName,
  initialApiKey,
  hasKey,
  subscriptionStatus,
  trialEndsAt,
  seatsPurchased,
  activeMemberCount,
  hasStripeCustomer,
  stripeConnectStatus,
}: {
  orgId: string
  userId: string
  role: Role
  isAdmin: boolean
  settings: Settings
  initialAccentColor: string
  initialDisplayName: string
  initialApiKey: string
  hasKey: boolean
  subscriptionStatus: Status
  trialEndsAt: string | null
  seatsPurchased: number
  activeMemberCount: number
  hasStripeCustomer: boolean
  stripeConnectStatus: 'not_connected' | 'pending' | 'active'
}) {
  const searchParams = useSearchParams()
  const requestedView = searchParams.get('view') as View | null
  const [view, setView] = useState<View>(requestedView && NAV.some((n) => n.value === requestedView) ? requestedView : 'general')

  const nav = NAV.filter((item) => (!item.adminOnly || isAdmin) && (!item.ownerOnly || role === 'owner'))

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Settings</h1>
      <div className="flex flex-col md:flex-row gap-6">
        <nav className="flex flex-wrap md:flex-col gap-1 md:w-44 shrink-0 mb-4 md:mb-0">
          {nav.map((item) => (
            <button
              key={item.value}
              onClick={() => setView(item.value)}
              className={`relative rounded-full px-3 py-2 text-sm whitespace-nowrap text-left transition-colors ${
                view === item.value ? 'font-medium text-ink' : 'text-sage hover:text-ink hover:bg-sand'
              }`}
            >
              {view === item.value && (
                <motion.div
                  layoutId="settings-nav-active"
                  className="absolute inset-0 rounded-full bg-white"
                  style={{ boxShadow: 'inset 2px 0 0 0 var(--accent), 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0">
          {view === 'general' && <GeneralClient orgId={orgId} isAdmin={isAdmin} settings={settings} />}
          {view === 'profile' && <ProfileClient orgId={orgId} userId={userId} initialDisplayName={initialDisplayName} />}
          {view === 'appearance' && <AppearanceClient orgId={orgId} isAdmin={isAdmin} initialAccentColor={initialAccentColor} />}
          {view === 'voice' && <VoiceClient orgId={orgId} isAdmin={isAdmin} settings={settings} />}
          {view === 'integrations' && (
            <IntegrationsClient
              orgId={orgId}
              isAdmin={isAdmin}
              isOwner={role === 'owner'}
              initialApiKey={initialApiKey}
              hasKey={hasKey}
              stripeConnectStatus={stripeConnectStatus}
            />
          )}
          {view === 'security' && <SecurityClient />}
          {view === 'data' && <DataClient orgId={orgId} isAdmin={isAdmin} />}
          {view === 'billing' && (
            <BillingClient
              orgId={orgId}
              role={role}
              subscriptionStatus={subscriptionStatus}
              trialEndsAt={trialEndsAt}
              seatsPurchased={seatsPurchased}
              activeMemberCount={activeMemberCount}
              hasStripeCustomer={hasStripeCustomer}
            />
          )}
        </div>
      </div>
    </div>
  )
}
