'use client'

import Button from '@/components/ui/Button'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-neutral-950 px-4 text-neutral-100">
      <div className="text-2xl font-semibold">Something went wrong</div>
      <p className="text-sm text-neutral-500">An unexpected error occurred. You can try again.</p>
      <Button variant="primary" onClick={reset} className="mt-2">
        Try again
      </Button>
    </main>
  )
}
