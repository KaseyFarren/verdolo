// Instant navigation feedback. These routes are fully dynamic (per-org RLS
// queries) and intentionally not prefetched, so without a Suspense fallback a
// nav click leaves the old page frozen on screen until every query resolves.
// This skeleton swaps in immediately (0ms) while the real page streams behind it.
export default function Loading() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="h-8 w-48 rounded-lg bg-ink/10" />
      <div className="mt-3 h-4 w-72 max-w-full rounded bg-ink/[0.06]" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-ink/[0.05]" />
        ))}
      </div>
    </div>
  )
}
