import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CreateOrgForm from './create-org-form'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: memberships } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)

  if (memberships && memberships.length > 0) redirect('/dashboard')

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4 bg-neutral-950 text-neutral-100">
      <h1 className="text-xl font-semibold">Set up your agency</h1>
      <p className="text-sm text-neutral-500">You&apos;re not part of an org yet — create one to get started.</p>
      <CreateOrgForm />
    </main>
  )
}
