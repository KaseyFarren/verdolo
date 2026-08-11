import { getClientContext } from '@/lib/client-portal'

// Deliberately calls getClientContext() (no paywall check) - this is where requireClientContext()
// sends a client when the paywall check fails, so re-checking it here would just redirect back.
export default async function PortalUnavailablePage() {
  await getClientContext()
  return (
    <div className="rounded-2xl bg-white border border-ink/8 p-6 text-center">
      <h1 className="text-lg font-semibold mb-1">This workspace is temporarily unavailable</h1>
      <p className="text-sm text-sage">Please reach out to your agency contact directly in the meantime.</p>
    </div>
  )
}
