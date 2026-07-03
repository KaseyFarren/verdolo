import AppShell from '@/components/AppShell'
import SettingsNav from '@/components/settings/SettingsNav'
import { requireOrgContext } from '@/lib/org'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // whole Settings section skips the paywall — an org with a lapsed subscription still
  // needs to reach every page here (not just get bounced straight to Billing) to fix it
  const { user, orgId, role, org } = await requireOrgContext({ skipPaywall: true })

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      <h1 className="text-xl font-semibold mb-6">Settings</h1>
      <div className="flex flex-col md:flex-row gap-6">
        <SettingsNav role={role} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </AppShell>
  )
}
