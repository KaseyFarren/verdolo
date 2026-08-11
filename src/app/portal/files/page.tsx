import { getClientContext } from '@/lib/client-portal'
import PortalFilesClient from './PortalFilesClient'

export default async function PortalFilesPage() {
  const { orgId, clientId } = await getClientContext()
  return <PortalFilesClient orgId={orgId} clientId={clientId} />
}
