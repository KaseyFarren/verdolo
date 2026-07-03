import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-cream px-4 text-ink">
      <div className="text-5xl font-semibold">404</div>
      <p className="text-sm text-sage">This page doesn&apos;t exist.</p>
      <Link href="/" className="mt-2 text-sm underline hover:text-sage">
        Back to Agency Hub
      </Link>
    </main>
  )
}
