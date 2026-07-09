import { isAdminRole, requireOrgContext } from '@/lib/org'
import { periodBounds, type Period } from '@/lib/period'
import TimeClient from './TimeClient'

const VALID_PERIODS: Period[] = ['all_time', 'this_week', 'last_week', 'this_month', 'last_month', 'custom']
const PAGE_SIZE = 100

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; start?: string; end?: string; clientId?: string; userId?: string; taskId?: string }>
}) {
  const { supabase, user, orgId, role } = await requireOrgContext()
  const isAdmin = isAdminRole(role)

  const sp = await searchParams
  const period: Period = VALID_PERIODS.includes(sp.period as Period) ? (sp.period as Period) : 'all_time'
  const bounds = periodBounds({ period, start: sp.start, end: sp.end })
  const filterClientId = sp.clientId || ''
  const filterUserId = isAdmin ? sp.userId || '' : ''
  const filterTaskId = sp.taskId || ''

  let entriesQuery = supabase.from('time_entries').select('*').eq('org_id', orgId)
  if (bounds.start) entriesQuery = entriesQuery.gte('started_at', bounds.start)
  if (bounds.end) entriesQuery = entriesQuery.lt('started_at', bounds.end)
  if (filterClientId) entriesQuery = entriesQuery.eq('client_id', filterClientId)
  if (filterUserId) entriesQuery = entriesQuery.eq('user_id', filterUserId)
  if (filterTaskId) entriesQuery = entriesQuery.eq('task_id', filterTaskId)
  entriesQuery = entriesQuery.order('started_at', { ascending: false }).limit(PAGE_SIZE)

  // time_archived_totals only holds lifetime-to-date-of-clearing sums with no per-entry
  // timestamp, so it can only be folded into a period-scoped view when that period is "all
  // time" - anything narrower and the archive can't be sliced to fit, so we simply don't fetch
  // it (TimeClient's summary math already treats an empty archivedTotals array as zero).
  const [{ data: clients }, { data: openTasks }, { data: allTasks }, { data: entries }, { data: members }, { data: archivedTotals }] = await Promise.all([
    supabase.from('clients').select('id, name, billing_mode').eq('org_id', orgId).order('name'),
    supabase.from('tasks').select('id, title, client_id').eq('org_id', orgId).eq('done', false),
    supabase.from('tasks').select('id, title, client_id').eq('org_id', orgId),
    entriesQuery,
    supabase.from('org_members').select('user_id, invited_email, display_name, avatar_url, role, title').eq('org_id', orgId).eq('status', 'active'),
    period === 'all_time'
      ? supabase.from('time_archived_totals').select('client_id, user_id, seconds').eq('org_id', orgId)
      : Promise.resolve({ data: [] as { client_id: string | null; user_id: string; seconds: number }[] }),
  ])

  return (
    <TimeClient
      orgId={orgId}
      userId={user.id}
      isAdmin={isAdmin}
      clients={clients ?? []}
      tasks={openTasks ?? []}
      allTasks={allTasks ?? []}
      initialEntries={entries ?? []}
      members={members ?? []}
      archivedTotals={archivedTotals ?? []}
      period={{ period, start: sp.start, end: sp.end }}
      filterClientId={filterClientId}
      filterUserId={filterUserId}
      filterTaskId={filterTaskId}
    />
  )
}
