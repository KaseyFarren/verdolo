import PortalShell from '@/components/PortalShell'
import { getClientContext } from '@/lib/client-portal'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { clientName } = await getClientContext()

  return <PortalShell clientName={clientName}>{children}</PortalShell>
}
