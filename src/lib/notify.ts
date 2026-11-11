import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { APP_URL, detailsBox, esc, renderEmail } from '@/lib/emailTemplate'
import { formatDate } from '@/lib/agency'

/**
 * Email notifications between a team and its client (portal). Everything here runs with the
 * service-role client: callers (the /api/notify route, the digest cron) have already checked
 * who's asking. Sends are best-effort - a failed email never fails the action it follows.
 */

export type Recipient = { userId: string; email: string; name: string }

const THROTTLE_MINUTES = 10

/** Emails of auth users, fetched one by one (admin API has no batch lookup by id). */
async function emailsFor(admin: SupabaseClient, userIds: string[]) {
  const out = new Map<string, string>()
  for (const id of [...new Set(userIds)]) {
    const { data } = await admin.auth.admin.getUserById(id)
    if (data.user?.email) out.set(id, data.user.email)
  }
  return out
}

/** Active portal contacts for a client. */
export async function clientRecipients(admin: SupabaseClient, clientId: string, opts: { digestOnly?: boolean } = {}): Promise<Recipient[]> {
  let q = admin.from('client_users').select('user_id, display_name, invited_email, daily_digest').eq('client_id', clientId).eq('status', 'active')
  if (opts.digestOnly) q = q.eq('daily_digest', true)
  const { data } = await q
  const rows = data ?? []
  const emails = await emailsFor(admin, rows.map((r) => r.user_id))
  return rows
    .map((r) => ({ userId: r.user_id, email: emails.get(r.user_id) ?? r.invited_email ?? '', name: r.display_name || (r.invited_email ?? '').split('@')[0] }))
    .filter((r) => r.email)
}

/** Who on the team hears about a client's activity: the client's owner (Clients > Owner) if set
 * and active, otherwise the org's owners/admins. */
export async function teamRecipientsForClient(admin: SupabaseClient, orgId: string, clientId: string | null, preferUserIds: string[] = []): Promise<Recipient[]> {
  const { data: members } = await admin.from('org_members').select('user_id, display_name, invited_email, role').eq('org_id', orgId).eq('status', 'active')
  const active = members ?? []
  let chosen = active.filter((m) => preferUserIds.includes(m.user_id))
  if (!chosen.length && clientId) {
    const { data: client } = await admin.from('clients').select('primary_contact_id').eq('id', clientId).maybeSingle()
    chosen = active.filter((m) => m.user_id === client?.primary_contact_id)
  }
  if (!chosen.length) chosen = active.filter((m) => m.role === 'owner' || m.role === 'admin')
  const emails = await emailsFor(admin, chosen.map((m) => m.user_id))
  return chosen
    .map((m) => ({ userId: m.user_id, email: emails.get(m.user_id) ?? m.invited_email ?? '', name: m.display_name || (m.invited_email ?? '').split('@')[0] }))
    .filter((r) => r.email)
}

/** Name a person shows up as in emails: team display name, client contact name, or email prefix. */
export async function personName(admin: SupabaseClient, userId: string, orgId: string) {
  const [{ data: m }, { data: c }] = await Promise.all([
    admin.from('org_members').select('display_name, invited_email').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
    admin.from('client_users').select('display_name, invited_email').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
  ])
  const row = m ?? c
  if (row?.display_name) return row.display_name as string
  if (row?.invited_email) return (row.invited_email as string).split('@')[0]
  const { data } = await admin.auth.admin.getUserById(userId)
  return data.user?.email?.split('@')[0] ?? 'Someone'
}

export async function isClientUser(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from('client_users').select('client_id').eq('user_id', userId).eq('status', 'active').maybeSingle()
  return data?.client_id as string | undefined
}

/** True if this recipient already got this kind of email about this thing in the last few
 * minutes - stops a quick back-and-forth from becoming ten emails. Records the send otherwise. */
async function throttled(admin: SupabaseClient, orgId: string, recipient: string, kind: string, refId: string) {
  const since = new Date(Date.now() - THROTTLE_MINUTES * 60000).toISOString()
  const { data } = await admin
    .from('notification_log')
    .select('id')
    .eq('recipient', recipient)
    .eq('kind', kind)
    .eq('ref_id', refId)
    .gte('sent_at', since)
    .limit(1)
  return !!data?.length
}

async function logSend(admin: SupabaseClient, orgId: string, recipient: string, kind: string, refId: string) {
  await admin.from('notification_log').insert({ org_id: orgId, recipient, kind, ref_id: refId })
}

function excerpt(text: string, max = 400) {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function quote(text: string) {
  return `<p style="margin:0; white-space:pre-wrap;">${esc(excerpt(text))}</p>`
}

async function deliver(
  admin: SupabaseClient,
  orgId: string,
  recipients: Recipient[],
  kind: string,
  refId: string,
  build: (r: Recipient) => { subject: string; html: string; text: string; replyTo?: string },
  opts: { throttle?: boolean } = {},
) {
  let sent = 0
  for (const r of recipients) {
    if (opts.throttle && (await throttled(admin, orgId, r.email, kind, refId))) continue
    const mail = build(r)
    const ok = await sendEmail({ to: r.email, ...mail })
    if (ok) {
      sent++
      await logSend(admin, orgId, r.email, kind, refId)
    }
  }
  return sent
}

const PORTAL_FOOTER = 'You get these when there’s news in your shared project. Just reply if anything looks off.'
const TEAM_FOOTER = 'Sent by Verdolo when a client is active in their portal.'

// ---------------------------------------------------------------------------------------------

/** A message posted in a client's thread. */
export async function notifyClientThreadMessage(admin: SupabaseClient, messageId: string, callerId: string) {
  const { data: msg } = await admin.from('messages').select('id, body, sender_id, thread_id, org_id, attachment_name').eq('id', messageId).maybeSingle()
  if (!msg || msg.sender_id !== callerId) return { sent: 0, reason: 'not your message' }
  const { data: thread } = await admin.from('message_threads').select('id, kind, client_id').eq('id', msg.thread_id).maybeSingle()
  if (!thread || thread.kind !== 'client' || !thread.client_id) return { sent: 0, reason: 'not a client thread' }

  const senderName = await personName(admin, callerId, msg.org_id)
  const body = msg.body?.trim() || (msg.attachment_name ? `Shared a file: ${msg.attachment_name}` : '')
  const fromClient = (await isClientUser(admin, callerId)) === thread.client_id

  if (fromClient) {
    const { data: client } = await admin.from('clients').select('name').eq('id', thread.client_id).maybeSingle()
    const team = await teamRecipientsForClient(admin, msg.org_id, thread.client_id)
    const sent = await deliver(admin, msg.org_id, team, 'message', thread.id, () => ({
      subject: `New message from ${senderName}`,
      html: renderEmail({
        preheader: excerpt(body, 90),
        heading: `${esc(senderName)} sent a message`,
        bodyHtml: `<p style="margin:0;">From the ${esc(client?.name ?? 'client')} portal:</p>${detailsBox(quote(body))}`,
        ctaText: 'Reply in Verdolo',
        ctaUrl: `${APP_URL}/messages`,
        footerNote: TEAM_FOOTER,
      }),
      text: `${senderName} (${client?.name ?? 'client'}) wrote:\n\n${body}\n\nReply: ${APP_URL}/messages`,
    }), { throttle: true })
    return { sent }
  }

  const contacts = await clientRecipients(admin, thread.client_id)
  const replyTo = (await admin.auth.admin.getUserById(callerId)).data.user?.email
  const sent = await deliver(admin, msg.org_id, contacts, 'message', thread.id, (r) => ({
    subject: `${senderName} sent you a message`,
    html: renderEmail({
      preheader: excerpt(body, 90),
      heading: `A message from ${esc(senderName)}`,
      bodyHtml: `<p style="margin:0;">Hi ${esc(r.name.split(' ')[0])}, here’s what ${esc(senderName)} said:</p>${detailsBox(quote(body))}`,
      ctaText: 'Reply in your portal',
      ctaUrl: `${APP_URL}/portal/messages`,
      footerNote: PORTAL_FOOTER,
    }),
    text: `${senderName} wrote:\n\n${body}\n\nReply in your portal: ${APP_URL}/portal/messages`,
    replyTo: replyTo ?? undefined,
  }), { throttle: true })
  return { sent }
}

/** Is this task one the client can see in their portal? Mirrors tasks_client_select (0091). */
export async function isPortalTask(admin: SupabaseClient, task: { client_id: string | null; project_id: string | null; parent_task_id: string | null; archived: boolean; client_visible: boolean; for_client: boolean; requested_by: string | null }) {
  if (!task.client_id || task.parent_task_id || task.archived) return false
  if (task.client_visible || task.for_client || task.requested_by) return true
  if (!task.project_id) return false
  const { data: p } = await admin.from('projects').select('client_id').eq('id', task.project_id).maybeSingle()
  return p?.client_id === task.client_id
}

const TASK_FIELDS = 'id, org_id, title, notes, due_date, done, client_id, project_id, parent_task_id, archived, client_visible, for_client, requested_by, assigned_to, assignee_ids'

/** A comment on a task. Client comments go to the team; team comments go to the client only
 * when the task is in their portal (an internal task's comments stay internal). */
export async function notifyTaskComment(admin: SupabaseClient, commentId: string, callerId: string) {
  const { data: c } = await admin.from('task_comments').select('id, body, author_id, task_id, org_id').eq('id', commentId).maybeSingle()
  if (!c || c.author_id !== callerId) return { sent: 0, reason: 'not your comment' }
  const { data: task } = await admin.from('tasks').select(TASK_FIELDS).eq('id', c.task_id).maybeSingle()
  if (!task || !task.client_id) return { sent: 0, reason: 'task has no client' }

  const author = await personName(admin, callerId, c.org_id)
  const fromClient = (await isClientUser(admin, callerId)) === task.client_id

  if (fromClient) {
    const assignees = [task.assigned_to, ...(task.assignee_ids ?? [])].filter(Boolean) as string[]
    const team = await teamRecipientsForClient(admin, c.org_id, task.client_id, assignees)
    const sent = await deliver(admin, c.org_id, team, 'comment', task.id, () => ({
      subject: `${author} commented on a task`,
      html: renderEmail({
        preheader: excerpt(c.body, 90),
        heading: `${esc(author)} commented`,
        bodyHtml: `<p style="margin:0;">On <strong>${esc(task.title)}</strong>:</p>${detailsBox(quote(c.body))}`,
        ctaText: 'Open the task',
        ctaUrl: `${APP_URL}/tasks?task=${task.id}`,
        footerNote: TEAM_FOOTER,
      }),
      text: `${author} commented on "${task.title}":\n\n${c.body}\n\n${APP_URL}/tasks?task=${task.id}`,
    }), { throttle: true })
    return { sent }
  }

  if (!(await isPortalTask(admin, task))) return { sent: 0, reason: 'internal task' }
  const contacts = await clientRecipients(admin, task.client_id)
  const replyTo = (await admin.auth.admin.getUserById(callerId)).data.user?.email
  const sent = await deliver(admin, c.org_id, contacts, 'comment', task.id, () => ({
    subject: `${author} left a note on a task`,
    html: renderEmail({
      preheader: excerpt(c.body, 90),
      heading: `A note from ${esc(author)}`,
      bodyHtml: `<p style="margin:0;">On <strong>${esc(task.title)}</strong>:</p>${detailsBox(quote(c.body))}`,
      ctaText: 'Open in your portal',
      ctaUrl: `${APP_URL}/portal?task=${task.id}`,
      footerNote: PORTAL_FOOTER,
    }),
    text: `${author} commented on "${task.title}":\n\n${c.body}\n\n${APP_URL}/portal?task=${task.id}`,
    replyTo: replyTo ?? undefined,
  }), { throttle: true })
  return { sent }
}

/** The client added a task for the team from the portal. */
export async function notifyClientAddedTask(admin: SupabaseClient, taskId: string, callerId: string) {
  const { data: task } = await admin.from('tasks').select(TASK_FIELDS).eq('id', taskId).maybeSingle()
  if (!task || task.requested_by !== callerId || !task.client_id) return { sent: 0, reason: 'not your request' }
  const author = await personName(admin, callerId, task.org_id)
  const team = await teamRecipientsForClient(admin, task.org_id, task.client_id, [task.assigned_to].filter(Boolean) as string[])
  const due = task.due_date ? formatDate(task.due_date) : null
  const sent = await deliver(admin, task.org_id, team, 'client_task', task.id, () => ({
    subject: `${author} added a task for you`,
    html: renderEmail({
      preheader: excerpt(task.title, 90),
      heading: `New from ${esc(author)}`,
      bodyHtml: `<p style="margin:0;">Added from their portal and on your task list now.</p>${detailsBox(
        `<p style="margin:0; font-weight:600;">${esc(task.title)}</p>${due ? `<p style="margin:6px 0 0 0; color:#5d6b5c;">Wanted by ${esc(due)}</p>` : ''}${
          task.notes ? `<p style="margin:10px 0 0 0; white-space:pre-wrap;">${esc(excerpt(task.notes))}</p>` : ''
        }`,
      )}`,
      ctaText: 'Open the task',
      ctaUrl: `${APP_URL}/tasks?task=${task.id}`,
      footerNote: TEAM_FOOTER,
    }),
    text: `${author} added a task: ${task.title}${due ? ` (wanted by ${due})` : ''}\n\n${task.notes ?? ''}\n\n${APP_URL}/tasks?task=${task.id}`,
  }))
  return { sent }
}

/** The client ticked off one of their own to-dos. */
export async function notifyClientDone(admin: SupabaseClient, taskId: string, callerId: string) {
  const { data: task } = await admin.from('tasks').select(TASK_FIELDS).eq('id', taskId).maybeSingle()
  if (!task || !task.for_client || !task.done || !task.client_id) return { sent: 0, reason: 'not a finished client to-do' }
  if ((await isClientUser(admin, callerId)) !== task.client_id) return { sent: 0, reason: 'not your client' }
  const author = await personName(admin, callerId, task.org_id)
  const assignees = [task.assigned_to, ...(task.assignee_ids ?? [])].filter(Boolean) as string[]
  const team = await teamRecipientsForClient(admin, task.org_id, task.client_id, assignees)
  const sent = await deliver(admin, task.org_id, team, 'client_done', task.id, () => ({
    subject: `${author} finished: ${excerpt(task.title, 40)}`,
    html: renderEmail({
      preheader: 'One less thing waiting on them.',
      heading: `${esc(author)} ticked something off`,
      bodyHtml: detailsBox(`<p style="margin:0; font-weight:600;">✓ ${esc(task.title)}</p>`),
      ctaText: 'Open the task',
      ctaUrl: `${APP_URL}/tasks?task=${task.id}`,
      footerNote: TEAM_FOOTER,
    }),
    text: `${author} finished: ${task.title}\n\n${APP_URL}/tasks?task=${task.id}`,
  }), { throttle: true })
  return { sent }
}
