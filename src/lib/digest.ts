import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { APP_URL, detailsBox, esc, renderEmail } from '@/lib/emailTemplate'
import { formatDate, isWeekend, todayKey } from '@/lib/agency'
import { addDays } from '@/lib/period'
import { ensureAutoAndRecurringTasks } from '@/lib/taskGen'
import { clientRecipients, teamRecipientsForClient } from '@/lib/notify'

type Task = {
  id: string
  title: string
  due_date: string | null
  done: boolean
  completed_at: string | null
  client_id: string | null
  project_id: string | null
  for_client: boolean
  client_visible: boolean
  requested_by: string | null
  assigned_to: string | null
  assignee_ids: string[] | null
  created_at: string
}

const TASK_COLS = 'id, title, due_date, done, completed_at, client_id, project_id, for_client, client_visible, requested_by, assigned_to, assignee_ids, created_at'
const MAX_ROWS = 10

function hasActiveAccess(org: { subscription_status: string | null; trial_ends_at: string | null }) {
  if (org.subscription_status === 'active' || org.subscription_status === 'past_due') return true
  return org.subscription_status === 'trialing' && (!org.trial_ends_at || org.trial_ends_at > new Date().toISOString())
}

/** Runs the same idempotent generation the Dashboard/Tasks pages do on load, so today's
 * recurring tasks exist (and are in the digest) even if nobody has opened the app yet. */
export async function generateTodaysTasks(admin: SupabaseClient, orgId: string, excludeWeekends: boolean) {
  const [{ data: clients }, { data: recurring }, { data: defaults }] = await Promise.all([
    admin.from('clients').select('id, stage, status').eq('org_id', orgId),
    admin.from('recurring_templates').select('*').eq('org_id', orgId),
    admin.from('default_task_templates').select('*').eq('org_id', orgId),
  ])
  return ensureAutoAndRecurringTasks(admin, orgId, clients ?? [], recurring ?? [], defaults ?? [], excludeWeekends)
}

function dueLabel(due: string | null, today: string) {
  if (!due) return ''
  if (due < today) return `<span style="color:#c0392b;">was due ${esc(formatDate(due))}</span>`
  if (due === today) return 'today'
  return esc(formatDate(due))
}

function list(title: string, rows: { title: string; meta?: string }[]) {
  if (!rows.length) return ''
  const shown = rows.slice(0, MAX_ROWS)
  const more = rows.length - shown.length
  return detailsBox(
    `<p style="margin:0 0 8px 0; font-weight:600;">${esc(title)}</p>` +
      shown
        .map((r) => `<p style="margin:0 0 6px 0;">${esc(r.title)}${r.meta ? ` <span style="color:#5d6b5c; font-size:14px;">· ${r.meta}</span>` : ''}</p>`)
        .join('') +
      (more > 0 ? `<p style="margin:4px 0 0 0; color:#5d6b5c; font-size:14px;">and ${more} more</p>` : ''),
  )
}

function textList(title: string, rows: { title: string; due?: string | null }[]) {
  if (!rows.length) return ''
  return `${title}\n${rows.map((r) => `- ${r.title}${r.due ? ` (${r.due})` : ''}`).join('\n')}\n\n`
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Portal-visible tasks for one client (same rule as tasks_client_select in 0091). */
async function portalTasks(admin: SupabaseClient, clientId: string): Promise<Task[]> {
  const [{ data: tasks }, { data: projects }] = await Promise.all([
    admin.from('tasks').select(TASK_COLS).eq('client_id', clientId).is('parent_task_id', null).eq('archived', false).eq('skipped', false).limit(2000),
    admin.from('projects').select('id').eq('client_id', clientId).neq('status', 'archived'),
  ])
  const own = new Set((projects ?? []).map((p) => p.id))
  return ((tasks ?? []) as Task[]).filter((t) => t.client_visible || t.for_client || t.requested_by || (t.project_id && own.has(t.project_id)))
}

async function sendClientDigest(admin: SupabaseClient, orgId: string, client: { id: string; name: string }, today: string) {
  const contacts = await clientRecipients(admin, client.id, { digestOnly: true })
  if (!contacts.length) return 0
  const tasks = await portalTasks(admin, client.id)
  const weekAhead = addDays(today, 7)
  const since = new Date(Date.now() - 24 * 3600000).toISOString()
  const byDue = (a: Task, b: Task) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')

  const waiting = tasks.filter((t) => t.for_client && !t.done).sort(byDue)
  const teamToday = tasks.filter((t) => !t.for_client && !t.done && t.due_date && t.due_date <= today).sort(byDue)
  const comingUp = tasks.filter((t) => !t.for_client && !t.done && t.due_date && t.due_date > today && t.due_date <= weekAhead).sort(byDue)
  const doneRecently = tasks.filter((t) => !t.for_client && t.done && t.completed_at && t.completed_at >= since)
  if (!waiting.length && !teamToday.length && !comingUp.length && !doneRecently.length) return 0

  const team = await teamRecipientsForClient(admin, orgId, client.id)
  const teamName = team[0]?.name?.split(' ')[0] || 'your team'
  let sent = 0
  for (const r of contacts) {
    const first = r.name.split(' ')[0]
    const subject = waiting.length
      ? `${plural(waiting.length, 'thing')} waiting on you today`
      : `Your project update for today`
    const preheader = [
      waiting.length ? `${plural(waiting.length, 'item')} for you` : null,
      teamToday.length ? `${teamName} has ${plural(teamToday.length, 'task')} on today` : null,
      doneRecently.length ? `${doneRecently.length} done since yesterday` : null,
    ]
      .filter(Boolean)
      .join(', ')
    const html = renderEmail({
      preheader,
      heading: `Good morning, ${esc(first)}`,
      bodyHtml:
        `<p style="margin:0;">Here’s where ${esc(client.name)} stands today.</p>` +
        list('Waiting on you', waiting.map((t) => ({ title: t.title, meta: dueLabel(t.due_date, today) }))) +
        list(`${teamName} is working on today`, teamToday.map((t) => ({ title: t.title, meta: t.due_date && t.due_date < today ? dueLabel(t.due_date, today) : '' }))) +
        list('Done since yesterday', doneRecently.map((t) => ({ title: `✓ ${t.title}` }))) +
        list('Coming up this week', comingUp.map((t) => ({ title: t.title, meta: dueLabel(t.due_date, today) }))),
      ctaText: waiting.length ? 'Tick things off' : 'Open your project',
      ctaUrl: `${APP_URL}/portal`,
      footerNote: `You get this each morning there’s something to see. <a href="${APP_URL}/portal?digest=off" style="color:#5d6b5c;">Turn off morning emails</a>`,
    })
    const text =
      `Good morning ${first},\n\nHere's where ${client.name} stands today.\n\n` +
      textList('Waiting on you', waiting.map((t) => ({ title: t.title, due: t.due_date ? formatDate(t.due_date) : null }))) +
      textList(`${teamName} is working on today`, teamToday.map((t) => ({ title: t.title }))) +
      textList('Done since yesterday', doneRecently.map((t) => ({ title: t.title }))) +
      textList('Coming up this week', comingUp.map((t) => ({ title: t.title, due: t.due_date ? formatDate(t.due_date) : null }))) +
      `Open your project: ${APP_URL}/portal\nTurn off morning emails: ${APP_URL}/portal?digest=off`
    if (await sendEmail({ to: r.email, subject, html, text, replyTo: team[0]?.email })) sent++
  }
  return sent
}

async function sendTeamDigests(admin: SupabaseClient, orgId: string, today: string) {
  const { data: members } = await admin.from('org_members').select('user_id, role, display_name, invited_email').eq('org_id', orgId).eq('status', 'active')
  if (!members?.length) return 0
  const { data: openTasks } = await admin
    .from('tasks')
    .select(TASK_COLS)
    .eq('org_id', orgId)
    .eq('done', false)
    .eq('archived', false)
    .eq('skipped', false)
    .is('parent_task_id', null)
    .lte('due_date', today)
    .limit(3000)
  const since = new Date(Date.now() - 24 * 3600000).toISOString()
  const { data: requests } = await admin.from('tasks').select(TASK_COLS).eq('org_id', orgId).not('requested_by', 'is', null).gte('created_at', since).limit(200)
  const { data: clients } = await admin.from('clients').select('id, name').eq('org_id', orgId)
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name as string]))
  const withClient = (t: Task) => (t.client_id && clientName.get(t.client_id) ? ` <span style="color:#5d6b5c;">(${esc(clientName.get(t.client_id))})</span>` : '')

  let sent = 0
  for (const m of members) {
    const mine = ((openTasks ?? []) as Task[]).filter((t) => !t.for_client && (t.assigned_to === m.user_id || (t.assignee_ids ?? []).includes(m.user_id)))
    const overdue = mine.filter((t) => t.due_date! < today)
    const dueToday = mine.filter((t) => t.due_date === today)
    const isLead = m.role === 'owner' || m.role === 'admin'
    const fromClients = ((requests ?? []) as Task[]).filter((t) => t.assigned_to === m.user_id || (isLead && !t.assigned_to))
    const waitingOnClients = isLead ? ((openTasks ?? []) as Task[]).filter((t) => t.for_client && t.due_date! < today) : []
    if (!overdue.length && !dueToday.length && !fromClients.length && !waitingOnClients.length) continue

    const { data: u } = await admin.auth.admin.getUserById(m.user_id)
    const email = u.user?.email
    if (!email) continue
    const first = (m.display_name || email.split('@')[0]).split(' ')[0]
    const row = (t: Task, meta = '') => ({ title: t.title, meta: (meta ? meta : '') + (withClient(t) ? withClient(t) : '') })
    const html = renderEmail({
      preheader: [dueToday.length ? `${dueToday.length} due today` : null, overdue.length ? `${overdue.length} overdue` : null, fromClients.length ? `${fromClients.length} new from clients` : null]
        .filter(Boolean)
        .join(', '),
      heading: `Good morning, ${esc(first)}`,
      bodyHtml:
        `<p style="margin:0;">Here’s your day.</p>` +
        list('Due today', dueToday.map((t) => row(t))) +
        list('Overdue', overdue.map((t) => row(t, dueLabel(t.due_date, today)))) +
        list('New from clients', fromClients.map((t) => row(t))) +
        list('Overdue on the client’s side', waitingOnClients.map((t) => row(t, dueLabel(t.due_date, today)))),
      ctaText: 'Open Verdolo',
      ctaUrl: `${APP_URL}/dashboard`,
      footerNote: 'Your morning summary from Verdolo. Owners can turn it off in Settings, General.',
    })
    const text =
      `Good morning ${first},\n\n` +
      textList('Due today', dueToday) +
      textList('Overdue', overdue.map((t) => ({ title: t.title, due: t.due_date ? formatDate(t.due_date) : null }))) +
      textList('New from clients', fromClients) +
      textList("Overdue on the client's side", waitingOnClients) +
      `${APP_URL}/dashboard`
    const subject = dueToday.length || overdue.length ? `Today: ${plural(dueToday.length, 'task')} due${overdue.length ? `, ${overdue.length} overdue` : ''}` : `New from your clients`
    if (await sendEmail({ to: email, subject, html, text })) sent++
  }
  return sent
}

/** The whole morning run. `onlyOrgId` limits it to one org (manual test runs). */
export async function runMorningDigest(admin: SupabaseClient, opts: { onlyOrgId?: string; today?: string } = {}) {
  const today = opts.today ?? todayKey()
  let q = admin.from('orgs').select('id, settings, subscription_status, trial_ends_at')
  if (opts.onlyOrgId) q = q.eq('id', opts.onlyOrgId)
  const { data: orgs } = await q
  const summary = { orgs: 0, generated: 0, clientEmails: 0, teamEmails: 0 }

  for (const org of orgs ?? []) {
    if (!hasActiveAccess(org)) continue
    const settings = (org.settings ?? {}) as { exclude_weekends?: boolean; team_digest?: boolean; client_digest?: boolean }
    const excludeWeekends = settings.exclude_weekends ?? true
    summary.orgs++
    try {
      summary.generated += (await generateTodaysTasks(admin, org.id, excludeWeekends)).length
    } catch (err) {
      console.error('[digest] task generation failed', org.id, err)
    }
    if (excludeWeekends && isWeekend(today)) continue

    if (settings.client_digest) {
      const { data: clients } = await admin.from('clients').select('id, name, stage, status').eq('org_id', org.id)
      for (const c of clients ?? []) {
        if (c.stage === 'Paused' || c.status === 'paused') continue
        try {
          summary.clientEmails += await sendClientDigest(admin, org.id, c, today)
        } catch (err) {
          console.error('[digest] client digest failed', c.id, err)
        }
      }
    }
    if (settings.team_digest) {
      try {
        summary.teamEmails += await sendTeamDigests(admin, org.id, today)
      } catch (err) {
        console.error('[digest] team digest failed', org.id, err)
      }
    }
  }
  return summary
}
