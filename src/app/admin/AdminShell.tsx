'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ConfirmProvider } from '@/components/ConfirmDialog'

export default function AdminShell({ userEmail, children }: { userEmail: string; children: React.ReactNode }) {
  const router = useRouter()

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <ConfirmProvider>
      <div className="min-h-screen bg-cream text-ink">
        <div className="border-b border-ink/10 bg-green text-cream px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="font-heading font-bold text-sm">
              Verdolo Admin
            </Link>
            <Link href="/admin/billing" className="text-xs text-cream/70 hover:text-white transition-colors">
              Billing
            </Link>
            <Link href="/dashboard" className="text-xs text-cream/70 hover:text-white transition-colors">
              ← Back to app
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-cream/50">{userEmail}</div>
            <button onClick={logout} className="text-xs text-cream/70 hover:text-white transition-colors">
              Log out
            </button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8">{children}</div>
      </div>
    </ConfirmProvider>
  )
}
