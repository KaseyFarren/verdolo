import AppShell from '@/components/AppShell'
import { getOrgContext } from '@/lib/org'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, orgId, role, org } = await getOrgContext()

  return (
    <AppShell orgId={orgId} userId={user.id} orgName={org?.name ?? ''} userEmail={user.email ?? ''} role={role} accentColor={org?.accent_color}>
      {children}
    </AppShell>
  )
}
