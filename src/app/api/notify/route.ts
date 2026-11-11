import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { notifyClientAddedTask, notifyClientDone, notifyClientThreadMessage, notifyTaskComment } from '@/lib/notify'

/**
 * Called by the browser right after it writes something the other side should hear about
 * (a client-thread message, a task comment, a task added or ticked from the portal). The
 * caller only passes an id; every check (is this yours, who should be told, is the task in the
 * portal) happens server-side in lib/notify.ts. Best-effort: never blocks the UI.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  if (!(await rateLimit(`notify:${user.id}`, 60, 60))) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { kind, id } = await request.json().catch(() => ({}))
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const admin = createAdminClient()
  try {
    switch (kind) {
      case 'message':
        return NextResponse.json(await notifyClientThreadMessage(admin, id, user.id))
      case 'comment':
        return NextResponse.json(await notifyTaskComment(admin, id, user.id))
      case 'client_task':
        return NextResponse.json(await notifyClientAddedTask(admin, id, user.id))
      case 'client_done':
        return NextResponse.json(await notifyClientDone(admin, id, user.id))
      default:
        return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })
    }
  } catch (err) {
    console.error('[notify]', kind, err)
    return NextResponse.json({ sent: 0 })
  }
}
