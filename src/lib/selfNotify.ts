// Task IDs this browser session just created or assigned to itself. NotificationSound consults
// this so you never get pinged for assigning work to yourself - a teammate assigning you the same
// task still pings, because their session never recorded the ID here. Entries carry a short expiry
// so a stale mark can't swallow a later, legitimate ping for the same task.
const selfAssigned = new Map<string, number>()
const TTL_MS = 15000

export function markSelfAssigned(taskId: string) {
  selfAssigned.set(taskId, Date.now() + TTL_MS)
}

// Reads and clears the mark. Returns true only if the current session set it within the TTL.
export function wasSelfAssigned(taskId: string): boolean {
  const expiry = selfAssigned.get(taskId)
  if (expiry === undefined) return false
  selfAssigned.delete(taskId)
  return expiry > Date.now()
}
