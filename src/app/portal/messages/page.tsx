import { getClientContext } from '@/lib/client-portal'
import PortalMessagesClient from './PortalMessagesClient'

export default async function PortalMessagesPage() {
  const { supabase, orgId, clientId, user } = await getClientContext()
  const { data: threadId } = await supabase.rpc('get_or_create_client_thread', { target_client_id: clientId })
  return <PortalMessagesClient orgId={orgId} threadId={threadId as string} userId={user.id} />
}
