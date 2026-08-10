// Fractional position between the two neighbors an item lands between, so a drop never needs to
// renumber the rest of the list (see supabase/migrations/0071_task_status_and_order.sql). Shared
// by the Kanban board (columns) and the project view (phase sections).
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before !== undefined && after !== undefined) return (before + after) / 2
  if (before !== undefined) return before + 1
  if (after !== undefined) return after - 1
  return 0
}
