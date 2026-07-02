// One-time import of data exported from the old Electron app (Settings → Data → Export
// all data (JSON)) into the new Supabase-backed org.
//
// Usage:
//   node scripts/import-legacy-data.mjs <path-to-export.json> <org-id> [<your-user-id>]
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [, , filePath, orgId, userId] = process.argv
if (!filePath || !orgId) {
  console.error('Usage: node scripts/import-legacy-data.mjs <path-to-export.json> <org-id> [<your-user-id>]')
  process.exit(1)
}

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const raw = JSON.parse(readFileSync(filePath, 'utf8'))
const { clients = [], tasks = [], notes = {}, messages = {} } = raw

function dollarsToCents(v) {
  return Math.round(Number(v || 0) * 100)
}

async function main() {
  const clientIdMap = new Map() // old id -> new uuid
  const clientNameMap = new Map() // name -> new uuid (for messages, keyed by name in the old app)

  console.log(`Importing ${clients.length} clients...`)
  for (const c of clients) {
    const { data, error } = await supabase
      .from('clients')
      .insert({
        org_id: orgId,
        name: c.name,
        business: c.business || null,
        platform: c.platform || null,
        service: c.service || null,
        notes: c.notes || null,
        tone: c.tone || null,
        talking_points: c.talkingPoints || null,
        cadence_days: c.cadence || 7,
        stage: c.stage || (c.status === 'inactive' ? 'Churned' : 'Active'),
        retainer_cents: dollarsToCents(c.retainer),
        contract_ends: c.contractEnds || null,
        last_contacted: c.lastContacted || null,
        added_date: c.addedDate || null,
        status: c.status || 'active',
      })
      .select('id')
      .single()
    if (error) {
      console.error(`  failed on client "${c.name}":`, error.message)
      continue
    }
    clientIdMap.set(c.id, data.id)
    clientNameMap.set(c.name, data.id)
  }

  console.log(`Importing ${tasks.length} tasks...`)
  let taskCount = 0
  for (const t of tasks) {
    const newClientId = t.clientId ? clientIdMap.get(t.clientId) : null
    const { error } = await supabase.from('tasks').insert({
      org_id: orgId,
      client_id: newClientId || null,
      title: t.title,
      due_date: t.dueDate,
      priority: t.priority || 'Medium',
      notes: t.notes || null,
      done: !!t.done,
      completed_at: t.completedAt || null,
      is_auto: !!t.isAuto,
      auto_type: t.autoType || null,
      is_gcal: !!t.isGcal,
      gcal_id: t.gcalId || null,
      time: t.time || null,
      quick: !!t.quick,
    })
    if (error) console.error(`  failed on task "${t.title}":`, error.message)
    else taskCount++
  }
  console.log(`  imported ${taskCount}/${tasks.length}`)

  console.log('Importing client notes...')
  let noteCount = 0
  for (const [oldClientId, clientNotes] of Object.entries(notes)) {
    const newClientId = clientIdMap.get(Number(oldClientId)) || clientIdMap.get(oldClientId)
    if (!newClientId) continue
    for (const n of clientNotes) {
      const { error } = await supabase.from('client_notes').insert({
        org_id: orgId,
        client_id: newClientId,
        author_id: userId || null,
        text: n.text,
        created_at: n.timestamp,
      })
      if (error) console.error('  failed on a note:', error.message)
      else noteCount++
    }
  }
  console.log(`  imported ${noteCount} notes`)

  console.log('Importing message history...')
  let msgCount = 0
  for (const [date, dayMessages] of Object.entries(messages)) {
    for (const m of dayMessages) {
      const clientId = clientNameMap.get(m.client)
      if (!clientId) continue
      const { error } = await supabase.from('ai_message_log').insert({
        org_id: orgId,
        client_id: clientId,
        message: m.message,
        generated_by: userId || null,
        created_at: `${date}T12:00:00Z`,
      })
      if (error) console.error('  failed on a message:', error.message)
      else msgCount++
    }
  }
  console.log(`  imported ${msgCount} messages`)

  console.log('\nDone. Note: recurring task templates and quick notes were not in the old export format and were not migrated — recreate any recurring tasks manually in Tasks → Recurring.')
}

main()
