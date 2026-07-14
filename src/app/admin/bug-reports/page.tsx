import { createAdminClient } from '@/lib/supabase/admin'
import BugReportsClient, { type BugReportRow } from './BugReportsClient'

export default async function AdminBugReportsPage() {
  const admin = createAdminClient()

  const { data: reports } = await admin
    .from('bug_reports')
    .select('id, user_email, page_url, description, status, created_at, orgs(name)')
    .order('created_at', { ascending: false })
    .limit(200)

  const rows: BugReportRow[] = (reports ?? []).map((r) => ({
    id: r.id,
    userEmail: r.user_email,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orgName: (r.orgs as any)?.name ?? null,
    pageUrl: r.page_url,
    description: r.description,
    status: r.status as BugReportRow['status'],
    createdAt: r.created_at,
  }))

  return <BugReportsClient reports={rows} />
}
