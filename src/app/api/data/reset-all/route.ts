import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/apiError'

// "Reset all data" from settings > Data. Wipes every org-owned table, not just clients/tasks/notes -
// otherwise things like messages, time entries, and reports survive a reset and keep showing up.
// ai_usage_log is the one exception: it's our own admin cost-tracking log (/admin/ai-usage), not
// org-owned data, so it's left alone. Storage objects (client-files, message-attachments) don't
// cascade from DB deletes, so they're listed and removed explicitly.
export async function POST(request: Request) {
  const { orgId } = await request.json()
  if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (membership?.role !== 'admin' && membership?.role !== 'owner') {
    return NextResponse.json({ error: 'Only admins can reset org data' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: threads } = await admin.from('message_threads').select('id').eq('org_id', orgId)
  const threadIds = (threads || []).map((t) => t.id)

  const clientFilesRemoved = await removeStoragePrefix(admin, 'client-files', `${orgId}/`)
  let attachmentsRemoved = 0
  for (const threadId of threadIds) {
    attachmentsRemoved += await removeStoragePrefix(admin, 'message-attachments', `${threadId}/`)
  }

  // Children before parents so nothing here depends on FK cascade to actually clean up.
  const tables = [
    'message_reactions',
    'message_mentions',
    'messages',
    'message_threads',
    'ai_message_log',
    'time_entries',
    'reports',
    'task_archived_totals',
    'bug_reports',
    'integration_connections',
    'recurring_templates',
    'default_task_templates',
    'project_phases',
    'projects',
    'quick_notes',
    'client_charges',
    'client_files',
    'client_health_snapshots',
    'client_notes',
    'inbox_messages',
    'inbox_threads',
    'proposals',
    'tracking_events',
    'time_archived_totals',
    'tasks',
    'clients',
  ] as const

  for (const table of tables) {
    const { error } = await admin.from(table).delete().eq('org_id', orgId)
    if (error) return apiError(`Could not clear ${table}`, 500, error)
  }

  return NextResponse.json({ ok: true, clientFilesRemoved, attachmentsRemoved })
}

async function removeStoragePrefix(admin: ReturnType<typeof createAdminClient>, bucket: string, prefix: string) {
  const { data: entries } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
  if (!entries || entries.length === 0) return 0

  const filePaths: string[] = []
  for (const entry of entries) {
    if (entry.id === null) {
      // Pseudo-folder - recurse one level to get the actual file paths.
      const { data: nested } = await admin.storage.from(bucket).list(`${prefix}${entry.name}/`, { limit: 1000 })
      for (const file of nested || []) filePaths.push(`${prefix}${entry.name}/${file.name}`)
    } else {
      filePaths.push(`${prefix}${entry.name}`)
    }
  }
  if (filePaths.length === 0) return 0

  const { error } = await admin.storage.from(bucket).remove(filePaths)
  if (error) throw error
  return filePaths.length
}
