import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-neutral-950 px-4 text-neutral-100">
      <div className="text-5xl font-semibold">404</div>
      <p className="text-sm text-neutral-500">This page doesn&apos;t exist.</p>
      <Link href="/" className="mt-2 text-sm underline hover:text-neutral-300">
        Back to Agency Hub
      </Link>
    </main>
  )
}
