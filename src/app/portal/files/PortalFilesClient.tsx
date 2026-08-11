'use client'

import { useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import ClientFiles from '@/components/ClientFiles'

export default function PortalFilesClient({ orgId, clientId }: { orgId: string; clientId: string }) {
  const supabase = useMemo(() => createClient(), [])
  return (
    <div className="rounded-2xl bg-white border border-ink/8 p-5">
      <ClientFiles supabase={supabase} orgId={orgId} clientId={clientId} canEdit />
    </div>
  )
}
