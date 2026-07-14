import { createClient } from '@supabase/supabase-js'
import { QA_PREFIX } from './helpers/qa-data'

// Sweeps up anything the e2e suite created (or left behind from a failed run) so tests never
// pollute the real kaseyfarren org, which also serves as sales-demo data - see memory
// project_verdolo_e2e_test_suite / project_verdolo_june_simulation. Runs once after the whole
// suite, using the service-role key (bypasses RLS) so cleanup succeeds even if a test failed
// mid-mutation or as a member without delete rights on some row.
export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return

  const supabase = createClient(url, key)
  const like = `${QA_PREFIX}%`

  // clients cascade-delete their notes/charges/files/proposals; tasks/time_entries only get
  // client_id nulled (not cascaded), so those are swept independently by title/description.
  const results = await Promise.all([
    supabase.from('clients').delete().like('name', like),
    supabase.from('tasks').delete().like('title', like),
    supabase.from('recurring_templates').delete().like('title', like),
    supabase.from('default_task_templates').delete().like('title', like),
    supabase.from('proposals').delete().like('title', like),
    supabase.from('time_entries').delete().like('note', like),
    supabase.from('client_notes').delete().like('text', like),
    supabase.from('messages').delete().like('body', like),
    supabase.from('client_charges').delete().like('description', like),
    // real seeded members get a QA title written during the Team edit test - clear it back out
    // rather than delete (deleting a real teammate row would be destructive)
    supabase.from('org_members').update({ title: null }).like('title', like),
  ])

  const failed = results.filter((r) => r.error)
  if (failed.length) {
    console.error('e2e teardown: some cleanup queries failed', failed.map((f) => f.error?.message))
  }
}
