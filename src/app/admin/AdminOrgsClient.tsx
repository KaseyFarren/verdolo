'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ConfirmDialog'

export type AdminOrgRow = {
  id: string
  name: string
  ownerEmail: string | null
  subscriptionStatus: string | null
  planType: string | null
  seatsPurchased: number
  activeMemberCount: number
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  createdAt: string
}

export type OrphanedUser = { id: string; email: string }

type SortKey = 'name' | 'subscriptionStatus' | 'seatsPurchased' | 'trialEndsAt' | 'currentPeriodEnd' | 'createdAt'

const STATUS_STYLES: Record<string, string> = {
  trialing: 'bg-amber-100 text-amber-700',
  active: 'bg-green/10 text-green',
  past_due: 'bg-red-100 text-red-700',
  canceled: 'bg-ink/10 text-sage',
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Days-left readout for trialing orgs - the raw trial_ends_at date alone doesn't answer "is
// this about to expire" at a glance, which is the thing admins actually want to scan for.
function trialStatus(subscriptionStatus: string | null, trialEndsAt: string | null): { label: string; className: string } | null {
  if (subscriptionStatus !== 'trialing') return null
  if (!trialEndsAt) return { label: 'No end date', className: 'text-sage' }
  const days = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { label: 'Expired', className: 'text-red-700 font-medium' }
  if (days === 0) return { label: 'Ends today', className: 'text-amber-700 font-medium' }
  if (days <= 3) return { label: `${days}d left`, className: 'text-amber-700 font-medium' }
  return { label: `${days}d left`, className: 'text-ink' }
}

function Th({
  label,
  sortableKey,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string
  sortableKey: SortKey
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === sortableKey
  return (
    <th
      className="text-left text-xs font-semibold tracking-wide text-sage px-3 py-2 cursor-pointer select-none"
      onClick={() => onSort(sortableKey)}
    >
      {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )
}

export default function AdminOrgsClient({ orgs, orphanedUsers }: { orgs: AdminOrgRow[]; orphanedUsers: OrphanedUser[] }) {
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [users, setUsers] = useState(orphanedUsers)
  const [deletingUser, setDeletingUser] = useState<string | null>(null)

  async function deleteOrphanedUser(user: OrphanedUser) {
    const confirmed = await confirm({
      title: `Delete ${user.email}?`,
      message: 'This account never finished setting up an org. Deleting it frees up the email for a fresh signup. This cannot be undone.',
      confirmLabel: 'Delete account',
      danger: true,
    })
    if (!confirmed) return
    setDeletingUser(user.id)
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    setDeletingUser(null)
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      toast.error(error ?? 'Could not delete account')
      return
    }
    setUsers((prev) => prev.filter((u) => u.id !== user.id))
    toast.success('Account deleted')
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = q
      ? orgs.filter((o) => o.name.toLowerCase().includes(q) || o.ownerEmail?.toLowerCase().includes(q))
      : orgs
    const sorted = [...matches].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [orgs, search, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-heading font-bold text-lg">Accounts</h1>
        <div className="text-xs text-sage">{orgs.length} org{orgs.length === 1 ? '' : 's'}</div>
      </div>

      <input
        type="text"
        placeholder="Search by org name or owner email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-4"
      />

      <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10">
              <Th label="Org" sortableKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="text-left text-xs font-semibold tracking-wide text-sage px-3 py-2">Owner</th>
              <th className="text-left text-xs font-semibold tracking-wide text-sage px-3 py-2">Plan</th>
              <Th label="Status" sortableKey="subscriptionStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Seats" sortableKey="seatsPurchased" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Trial ends" sortableKey="trialEndsAt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Next bill" sortableKey="currentPeriodEnd" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <Th label="Created" sortableKey="createdAt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((org) => (
              <tr key={org.id} className="border-b border-ink/5 last:border-0 hover:bg-sand/60">
                <td className="px-3 py-2">
                  <Link href={`/admin/orgs/${org.id}`} className="font-medium hover:underline">
                    {org.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-sage">{org.ownerEmail ?? '-'}</td>
                <td className="px-3 py-2">
                  {org.planType === 'lifetime' ? (
                    <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-accent/10 text-accent">Lifetime</span>
                  ) : (
                    <span className="text-sage">-</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[org.subscriptionStatus ?? ''] ?? 'bg-ink/10 text-sage'
                    }`}
                  >
                    {org.subscriptionStatus ?? 'none'}
                  </span>
                </td>
                <td className="px-3 py-2 text-sage">
                  {org.activeMemberCount}/{org.seatsPurchased}
                </td>
                <td className="px-3 py-2 text-sage">
                  {(() => {
                    const trial = trialStatus(org.subscriptionStatus, org.trialEndsAt)
                    return trial ? (
                      <div>
                        <div className={trial.className}>{trial.label}</div>
                        <div className="text-xs text-sage/70">{formatDate(org.trialEndsAt)}</div>
                      </div>
                    ) : (
                      '-'
                    )
                  })()}
                </td>
                <td className="px-3 py-2 text-sage">{formatDate(org.currentPeriodEnd)}</td>
                <td className="px-3 py-2 text-sage">{formatDate(org.createdAt)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sage">
                  No orgs match &quot;{search}&quot;
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {users.length > 0 && (
        <div className="mt-6">
          <div className="mb-2">
            <div className="text-sm font-medium text-ink">Orphaned accounts</div>
            <div className="text-xs text-sage">
              Signed up but never finished creating an org - not part of any account above, and their email can&apos;t be reused until deleted.
            </div>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white divide-y divide-ink/5">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{u.email}</span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => deleteOrphanedUser(u)}
                  disabled={deletingUser !== null}
                >
                  {deletingUser === u.id ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
