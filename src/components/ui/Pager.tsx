// Client-side pager for lists that hold their full dataset in local state (realtime-synced,
// optimistically mutated) and slice a page out of an already-filtered/sorted array rather than
// paging the server query. See TimeClient's entriesPage for the original of this pattern.
export default function Pager({
  page,
  totalPages,
  onChange,
  prevLabel = 'Previous',
  nextLabel = 'Next',
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
  prevLabel?: string
  nextLabel?: string
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="text-xs text-sage hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
      >
        {prevLabel}
      </button>
      <span className="text-xs text-sage">
        Page {page + 1} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        className="text-xs text-sage hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
      >
        {nextLabel}
      </button>
    </div>
  )
}
