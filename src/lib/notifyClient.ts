/** Fire-and-forget: tells the server something happened the other side should hear about by
 * email (see app/api/notify). Never awaited by the UI and never throws. */
export function notifyOther(kind: 'message' | 'comment' | 'client_task' | 'client_done', id: string | null | undefined) {
  if (!id) return
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, id }),
    keepalive: true,
  }).catch(() => {})
}
