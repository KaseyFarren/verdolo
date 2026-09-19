import { NextResponse } from 'next/server'
import { randomUUID, timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/apiError'

// Onboards one new client in a single call: client (or reuses an existing one), optional one-off
// setup charge, a project with phases, and its tasks. Built for the roadmap-to-Verdolo flow but
// deliberately generic. Authenticated by a shared key (ONBOARD_API_KEY) that is tied to exactly one
// org (ONBOARD_ORG_ID), so a leaked key can only ever touch that org. `dryRun: true` validates and
// reports what would be created without writing anything.
//
// Tasks with `internal: true` are attached to the client only (no project), which keeps them out of
// the client portal - the portal only lists tasks that belong to a project.

export const maxDuration = 60

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PRIORITIES = ['High', 'Medium', 'Low']
const MAX_PHASES = 20
const MAX_TASKS = 300
const MAX_SUBTASKS = 15
const MAX_ROWS = 600

type PlanTask = { title: string; phase: number | null; due_date: string; priority: string; notes: string | null; estimated_hours: number | null; internal: boolean; subtasks: { title: string; notes: string | null }[] }
type Plan = {
  dryRun: boolean
  client: { name: string; business: string | null; contact_email: string | null; stage: string; retainer_cents: number; billing_day: number; contract_ends: string | null; service: string | null; notes: string | null }
  charge: { description: string; amount_cents: number; charged_on: string } | null
  project: { name: string; description: string | null; start_date: string; due_date: string | null }
  phases: string[]
  tasks: PlanTask[]
}

function isAuthorized(request: Request) {
  const key = process.env.ONBOARD_API_KEY
  if (!key || key.length < 32) return false
  const a = Buffer.from(request.headers.get('authorization') ?? '')
  const b = Buffer.from(`Bearer ${key}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null)
const optStr = (v: unknown, max: number) => (v == null || v === '' ? null : str(v, max))
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v))

function parsePlan(body: unknown): { plan?: Plan; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be a JSON object' }
  const b = body as Record<string, unknown>
  const c = (b.client ?? {}) as Record<string, unknown>
  const p = (b.project ?? {}) as Record<string, unknown>

  const name = str(c.name, 200)
  if (!name) return { error: 'client.name is required' }
  const stage = c.stage == null ? 'Active' : String(c.stage)
  if (!['Lead', 'Active', 'Paused'].includes(stage)) return { error: 'client.stage must be Lead, Active or Paused' }
  const retainer = c.retainer_cents == null ? 0 : Number(c.retainer_cents)
  if (!Number.isInteger(retainer) || retainer < 0 || retainer > 100_000_000) return { error: 'client.retainer_cents must be a whole number of cents' }
  const billingDay = c.billing_day == null ? 1 : Number(c.billing_day)
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) return { error: 'client.billing_day must be 1 to 31' }
  const email = optStr(c.contact_email, 320)
  if (c.contact_email && !email) return { error: 'client.contact_email is invalid' }
  if (c.contract_ends != null && !isDate(c.contract_ends)) return { error: 'client.contract_ends must be YYYY-MM-DD' }

  const projectName = str(p.name, 200)
  if (!projectName) return { error: 'project.name is required' }
  if (!isDate(p.start_date)) return { error: 'project.start_date must be YYYY-MM-DD' }
  if (p.due_date != null && !isDate(p.due_date)) return { error: 'project.due_date must be YYYY-MM-DD' }

  let charge: Plan['charge'] = null
  if (b.charge != null) {
    const ch = b.charge as Record<string, unknown>
    const desc = str(ch.description, 200)
    const cents = Number(ch.amount_cents)
    if (!desc || !Number.isInteger(cents) || cents <= 0 || cents > 100_000_000 || !isDate(ch.charged_on)) return { error: 'charge needs description, amount_cents and charged_on' }
    charge = { description: desc, amount_cents: cents, charged_on: ch.charged_on }
  }

  const phasesIn = Array.isArray(b.phases) ? b.phases : []
  if (phasesIn.length > MAX_PHASES) return { error: `At most ${MAX_PHASES} phases` }
  const phases: string[] = []
  for (const ph of phasesIn) {
    const n = str((ph as Record<string, unknown>)?.name, 200)
    if (!n) return { error: 'Every phase needs a name' }
    phases.push(n)
  }

  const tasksIn = Array.isArray(b.tasks) ? b.tasks : []
  if (tasksIn.length > MAX_TASKS) return { error: `At most ${MAX_TASKS} tasks` }
  const tasks: PlanTask[] = []
  for (const [i, raw] of tasksIn.entries()) {
    const t = (raw ?? {}) as Record<string, unknown>
    const title = str(t.title, 200)
    if (!title) return { error: `tasks[${i}].title is required` }
    if (!isDate(t.due_date)) return { error: `tasks[${i}].due_date must be YYYY-MM-DD` }
    const priority = t.priority == null ? 'Medium' : String(t.priority)
    if (!PRIORITIES.includes(priority)) return { error: `tasks[${i}].priority must be High, Medium or Low` }
    const internal = t.internal === true
    let phase: number | null = null
    if (t.phase != null) {
      phase = Number(t.phase)
      if (!Number.isInteger(phase) || phase < 0 || phase >= phases.length) return { error: `tasks[${i}].phase is out of range` }
      if (internal) return { error: `tasks[${i}] cannot be internal and in a phase` }
    }
    const hours = t.estimated_hours == null ? null : Number(t.estimated_hours)
    if (hours != null && (!Number.isFinite(hours) || hours < 0 || hours > 1000)) return { error: `tasks[${i}].estimated_hours is invalid` }
    const subsIn = Array.isArray(t.subtasks) ? t.subtasks : []
    if (subsIn.length > MAX_SUBTASKS) return { error: `tasks[${i}] has more than ${MAX_SUBTASKS} subtasks` }
    const subtasks: PlanTask['subtasks'] = []
    for (const [j, sraw] of subsIn.entries()) {
      const st = (sraw ?? {}) as Record<string, unknown>
      const stitle = str(st.title, 200)
      if (!stitle) return { error: `tasks[${i}].subtasks[${j}].title is required` }
      subtasks.push({ title: stitle, notes: optStr(st.notes, 500) })
    }
    tasks.push({ title, phase, due_date: t.due_date, priority, notes: optStr(t.notes, 2000), estimated_hours: hours, internal, subtasks })
  }
  if (tasks.reduce((n, t) => n + 1 + t.subtasks.length, 0) > MAX_ROWS) return { error: `At most ${MAX_ROWS} tasks and subtasks in total` }

  return {
    plan: {
      dryRun: b.dryRun === true,
      client: { name, business: optStr(c.business, 200), contact_email: email, stage, retainer_cents: retainer, billing_day: billingDay, contract_ends: (c.contract_ends as string) ?? null, service: optStr(c.service, 200), notes: optStr(c.notes, 2000) },
      charge,
      project: { name: projectName, description: optStr(p.description, 1000), start_date: p.start_date, due_date: (p.due_date as string) ?? null },
      phases,
      tasks,
    },
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = process.env.ONBOARD_ORG_ID
  if (!orgId) return NextResponse.json({ error: 'Onboarding is not configured' }, { status: 503 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 })
  }
  const { plan, error: planError } = parsePlan(body)
  if (!plan) return NextResponse.json({ error: planError }, { status: 400 })

  const admin = createAdminClient()

  const { data: owner } = await admin.from('org_members').select('user_id').eq('org_id', orgId).eq('role', 'owner').eq('status', 'active').limit(1).maybeSingle()
  if (!owner?.user_id) return apiError('Org owner not found', 500)
  const ownerId = owner.user_id as string

  // Reuse an existing client of the same name (case-insensitive); refuse if it already has this project.
  const { data: existing } = await admin.from('clients').select('id, name').eq('org_id', orgId)
  const match = (existing ?? []).find((c) => c.name.trim().toLowerCase() === plan.client.name.toLowerCase())
  if (match) {
    const { data: dupe } = await admin.from('projects').select('id').eq('org_id', orgId).eq('client_id', match.id).eq('name', plan.project.name).limit(1)
    if (dupe?.length) return NextResponse.json({ error: 'This client already has a project with that name', clientId: match.id, projectId: dupe[0].id }, { status: 409 })
  }

  const summary = {
    client: match ? { reused: true, id: match.id, name: match.name } : { reused: false, name: plan.client.name, stage: plan.client.stage, retainer_cents: plan.client.retainer_cents, billing_day: plan.client.billing_day },
    charge: plan.charge,
    project: { name: plan.project.name, start_date: plan.project.start_date, due_date: plan.project.due_date },
    phases: plan.phases.length,
    tasks: { total: plan.tasks.length, subtasks: plan.tasks.reduce((n, t) => n + t.subtasks.length, 0), portal_visible: plan.tasks.filter((t) => !t.internal).length, internal: plan.tasks.filter((t) => t.internal).length, first_due: plan.tasks.map((t) => t.due_date).sort()[0] ?? null, last_due: plan.tasks.map((t) => t.due_date).sort().pop() ?? null },
  }
  if (plan.dryRun) return NextResponse.json({ dryRun: true, wouldCreate: summary })

  // Sequential inserts with compensating cleanup: if anything fails, remove what this call created.
  const created = { clientId: null as string | null, chargeId: null as string | null, projectId: null as string | null, taskIds: [] as string[] }
  const rollback = async () => {
    if (created.taskIds.length) await admin.from('tasks').delete().in('id', created.taskIds)
    if (created.chargeId) await admin.from('client_charges').delete().eq('id', created.chargeId)
    if (created.projectId) {
      await admin.from('tasks').delete().eq('org_id', orgId).eq('project_id', created.projectId)
      await admin.from('projects').delete().eq('id', created.projectId)
    }
    if (created.clientId) {
      await admin.from('tasks').delete().eq('org_id', orgId).eq('client_id', created.clientId)
      await admin.from('clients').delete().eq('id', created.clientId)
    }
  }

  try {
    let clientId = match?.id ?? null
    if (!clientId) {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await admin
        .from('clients')
        .insert({ org_id: orgId, name: plan.client.name, business: plan.client.business, service: plan.client.service, notes: plan.client.notes, tone: 'Friendly', cadence_days: 7, stage: plan.client.stage, billing_mode: 'retainer', retainer_cents: plan.client.retainer_cents, hourly_rate_cents: 0, billing_day: plan.client.billing_day, contract_ends: plan.client.contract_ends, contact_email: plan.client.contact_email, added_date: today })
        .select('id')
        .single()
      if (error || !data) throw error ?? new Error('client insert failed')
      clientId = data.id as string
      created.clientId = clientId
    }

    if (plan.charge) {
      const { data, error } = await admin.from('client_charges').insert({ org_id: orgId, client_id: clientId, ...plan.charge }).select('id').single()
      if (error || !data) throw error ?? new Error('charge insert failed')
      created.chargeId = data.id as string
    }

    const { data: project, error: projectError } = await admin
      .from('projects')
      .insert({ org_id: orgId, client_id: clientId, name: plan.project.name, description: plan.project.description, status: 'active', start_date: plan.project.start_date, due_date: plan.project.due_date, created_by: ownerId })
      .select('id')
      .single()
    if (projectError || !project) throw projectError ?? new Error('project insert failed')
    created.projectId = project.id as string

    let phaseIds: string[] = []
    if (plan.phases.length) {
      const { data, error } = await admin
        .from('project_phases')
        .insert(plan.phases.map((name, i) => ({ org_id: orgId, project_id: project.id, name, sort_order: i })))
        .select('id, sort_order')
      if (error || !data) throw error ?? new Error('phase insert failed')
      phaseIds = data.sort((a, b) => a.sort_order - b.sort_order).map((r) => r.id as string)
    }

    if (plan.tasks.length) {
      const base = { org_id: orgId, client_id: clientId, assignee_ids: [ownerId], assigned_to: ownerId, status: 'todo', quick: false, done: false }
      const rows = plan.tasks.map((t, i) => ({
        ...base,
        id: randomUUID(),
        project_id: t.internal ? null : project.id,
        phase_id: t.phase == null ? null : phaseIds[t.phase],
        title: t.title,
        due_date: t.due_date,
        priority: t.priority,
        notes: t.notes ?? '',
        estimated_hours: t.estimated_hours,
        sort_order: i,
      }))
      created.taskIds.push(...rows.map((r) => r.id))
      const { error } = await admin.from('tasks').insert(rows)
      if (error) throw error

      // Subtasks: one level, same project/phase/priority/due date as the parent. The portal only lists
      // top-level tasks, so subtasks (and notes) stay internal.
      const subRows = rows.flatMap((parent, i) =>
        plan.tasks[i].subtasks.map((st, j) => ({ ...base, id: randomUUID(), parent_task_id: parent.id, project_id: parent.project_id, phase_id: parent.phase_id, title: st.title, due_date: parent.due_date, priority: parent.priority, notes: st.notes ?? '', sort_order: j })),
      )
      if (subRows.length) {
        created.taskIds.push(...subRows.map((r) => r.id))
        const { error: subError } = await admin.from('tasks').insert(subRows)
        if (subError) throw subError
      }
    }

    return NextResponse.json({ ok: true, clientId, projectId: project.id, created: summary })
  } catch (err) {
    await rollback()
    return apiError('Could not complete the onboarding, nothing was saved', 500, err)
  }
}
