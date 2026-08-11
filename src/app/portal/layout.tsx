import PortalShell from '@/components/PortalShell'
import { getClientContext } from '@/lib/client-portal'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { clientName, contactName } = await getClientContext()

  return (
    <PortalShell clientName={clientName} contactName={contactName}>
      {children}
    </PortalShell>
  )
}
