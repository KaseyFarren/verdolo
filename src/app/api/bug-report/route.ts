import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/apiError'
import { rateLimit } from '@/lib/rateLimit'

const MAX_DESCRIPTION_LENGTH = 4000

async function notifyOwners(report: {
  description: string
  userEmail: string | null
  pageUrl: string | null
  orgName: string | null
}) {
  const apiKey = process.env.RESEND_API_KEY
  const recipients = (process.env.APP_OWNER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  if (!apiKey || recipients.length === 0) {
    console.error('[bug-report] RESEND_API_KEY or APP_OWNER_EMAILS not configured - skipping email')
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'Verdolo Bug Reports <bugs@verdolo.com>',
      to: recipients,
      subject: `Bug report${report.orgName ? ` - ${report.orgName}` : ''}`,
      text: [
        `From: ${report.userEmail ?? 'unknown'}`,
        `Org: ${report.orgName ?? 'unknown'}`,
        `Page: ${report.pageUrl ?? 'unknown'}`,
        '',
        report.description,
      ].join('\n'),
    }),
  })
  if (!res.ok) {
    console.error('[bug-report] Resend send failed:', res.status, await res.text())
  }
}

export async function POST(request: Request) {
  const { description, pageUrl } = await request.json()
  const trimmed = typeof description === 'string' ? description.trim() : ''
  if (!trimmed) {
    return NextResponse.json({ error: 'Please describe the problem' }, { status: 400 })
  }
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: 'That description is too long' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const allowed = await rateLimit(`bug-report:${user.id}`, 5, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many reports - please try again later' }, { status: 429 })
  }

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, orgs(name)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  const { error: insertError } = await supabase.from('bug_reports').insert({
    org_id: membership?.org_id ?? null,
    user_id: user.id,
    user_email: user.email ?? null,
    page_url: typeof pageUrl === 'string' ? pageUrl.slice(0, 500) : null,
    description: trimmed,
    user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
  })

  if (insertError) {
    return apiError('Could not submit your report', 500, insertError)
  }

  // Best-effort - the DB row is the source of truth, so a failed/misconfigured email
  // shouldn't turn into a failed submission for the user.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orgName = (membership?.orgs as any)?.name ?? null
    await notifyOwners({ description: trimmed, userEmail: user.email ?? null, pageUrl, orgName })
  } catch (err) {
    console.error('[bug-report] notifyOwners threw:', err)
  }

  return NextResponse.json({ ok: true })
}
