import AppShell from '@/components/AppShell'
import { requireOrgContext } from '@/lib/org'
import InviteForm from './invite-form'

export default async function TeamPage() {
  const { supabase, user, orgId, role, org } = await requireOrgContext()

  const { data: members } = await supabase
    .from('org_members')
    .select('id, role, status, invited_email, joined_at')
    .eq('org_id', orgId)
    .order('joined_at', { ascending: true })

  return (
    <AppShell orgName={org?.name ?? ''} userEmail={user.email ?? ''}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-neutral-500">{org?.name} · signed in as {user.email} ({role})</p>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-neutral-400">Members</h2>
        <ul className="divide-y divide-white/10 rounded border border-white/10">
          {members?.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{m.invited_email ?? '—'}</span>
              <span className="text-neutral-500">
                {m.role}
                {m.status === 'invited' ? ' · invited' : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {role === 'admin' && <InviteForm orgId={orgId} />}
    </AppShell>
  )
}
