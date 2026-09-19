import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Logo from '@/components/Logo'
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

  const { data: clientMemberships } = await supabase
    .from('client_users')
    .select('client_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)

  if (clientMemberships && clientMemberships.length > 0) redirect('/portal')

  // Someone who verified an invite link but never finished the password step has a pending row that
  // RLS hides above, so they looked like a brand-new user and were offered their own workspace.
  // A pending invite (team or client) must be finished, not bypassed by creating another org.
  const { data: hasPendingInvite } = await supabase.rpc('has_pending_invite')
  if (hasPendingInvite === true) redirect('/accept-invite')

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-5 bg-cream text-ink">
      <div className="mb-2 flex justify-center">
        <Logo size={24} />
      </div>
      <h1 className="text-xl font-semibold text-center">Set up your agency</h1>
      <p className="text-sm text-sage text-center">You&apos;re not part of an org yet - create one to get started.</p>
      <CreateOrgForm />
    </main>
  )
}
