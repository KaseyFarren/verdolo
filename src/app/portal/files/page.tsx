import { requireClientContext } from '@/lib/client-portal'
import PortalFilesClient from './PortalFilesClient'

export default async function PortalFilesPage() {
  const { orgId, clientId } = await requireClientContext()
  return <PortalFilesClient orgId={orgId} clientId={clientId} />
}
