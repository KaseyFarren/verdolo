'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import { getInitials, memberName } from '@/lib/agency'
import CustomSelect from '@/components/ui/CustomSelect'

type Member = {
  id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  title: string | null
  target_hours_per_week: number | null
  status: string
  invited_email: string | null
  display_name: string | null
  avatar_url: string | null
}

export default function MembersList({
  orgId,
  members,
  currentUserId,
  canManage,
  canManageOwners,
}: {
  orgId: string
  members: Member[]
  currentUserId: string
  canManage: boolean
  canManageOwners: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()
  const [rows, setRows] = useState(members)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // router.refresh() after inviting gives a new `members` array, but useState's initializer
  // only runs on mount - without this, a fresh invite won't show up until a manual reload.
  useEffect(() => {
    setRows(members)
  }, [members])

  async function changeRole(m: Member, role: 'owner' | 'admin' | 'member') {
    const { data } = await supabase.from('org_members').update({ role }).eq('id', m.id).select().single()
    if (data) {
      setRows((prev) => prev.map((r) => (r.id === m.id ? (data as Member) : r)))
      toast.success(`${memberName(m)} is now ${role}`)
    }
  }

  async function saveTitle(m: Member, title: string) {
    const trimmed = title.trim() || null
    if (trimmed === m.title) return
    const { data } = await supabase.from('org_members').update({ title: trimmed }).eq('id', m.id).select().single()
    if (data) {
      setRows((prev) => prev.map((r) => (r.id === m.id ? (data as Member) : r)))
      toast.success('Title updated')
    }
  }

  async function saveTargetHours(m: Member, value: string) {
    const trimmed = value.trim()
    const parsed = trimmed === '' ? null : Math.max(0, Math.round(Number(trimmed)))
    if (trimmed !== '' && Number.isNaN(parsed)) return
    if (parsed === m.target_hours_per_week) return
    const { data } = await supabase.from('org_members').update({ target_hours_per_week: parsed }).eq('id', m.id).select().single()
    if (data) {
      setRows((prev) => prev.map((r) => (r.id === m.id ? (data as Member) : r)))
      toast.success('Target hours updated')
    }
  }

  async function resendInvite(m: Member) {
    setResendingId(m.id)
    const res = await fetch('/api/invite/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, memberId: m.id }),
    })
    const body = await res.json().catch(() => ({}))
    setResendingId(null)
    if (!res.ok) {
      toast.error(body.error ?? 'Could not resend invite')
      return
    }
    toast.success(`Invite resent to ${m.invited_email}`)
  }

  async function removeMember(m: Member) {
    const ok = await confirm({
      title: `Remove ${memberName(m)}?`,
      message: 'They will lose access to this organization immediately.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setRemovingId(m.id)
    const { error } = await supabase.from('org_members').delete().eq('id', m.id)
    if (!error) {
      setRows((prev) => prev.filter((r) => r.id !== m.id))
      toast.success(`${memberName(m)} removed`)
    }
    setRemovingId(null)
  }

  const q = search.trim().toLowerCase()
  const filteredRows = rows.filter((m) => !q || memberName(m).toLowerCase().includes(q) || (m.invited_email ?? '').toLowerCase().includes(q))

  return (
    <div>
      {rows.length > 4 && (
        <input
          className="w-full max-w-xs rounded-full border border-ink/10 bg-white px-3 py-1.5 text-sm mb-3"
          placeholder="Search team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <ul className="divide-y divide-ink/8 rounded-2xl border border-ink/8 bg-white overflow-hidden">
      {filteredRows.length === 0 && <li className="px-3 py-4 text-sm text-sage">No teammates match your search.</li>}
      {filteredRows.map((m) => {
        const isSelf = m.user_id === currentUserId
        const canTouch = canManage && !isSelf && (m.role !== 'owner' || canManageOwners)
        return (
          <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              {m.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" />
              ) : (
                <div className="h-6 w-6 rounded-full bg-ink/5 flex items-center justify-center text-xs font-semibold shrink-0">
                  {getInitials(memberName(m))}
                </div>
              )}
              <div className="min-w-0">
                <span className="truncate">
                  {memberName(m)}
                  {isSelf && <span className="text-sage"> (you)</span>}
                </span>
                {canManage ? (
                  <div className="flex items-center gap-2">
                    <input
                      defaultValue={m.title ?? ''}
                      placeholder="Add role/title…"
                      onBlur={(e) => saveTitle(m, e.target.value)}
                      className="w-32 rounded border border-transparent hover:border-ink/10 focus:border-ink/10 bg-transparent px-1 -mx-1 text-xs text-sage focus:bg-white outline-none"
                    />
                    <span className="flex items-center gap-1 text-xs text-sage/70 shrink-0">
                      <input
                        type="number"
                        min="0"
                        defaultValue={m.target_hours_per_week ?? ''}
                        placeholder="-"
                        onBlur={(e) => saveTargetHours(m, e.target.value)}
                        className="w-10 rounded border border-transparent hover:border-ink/10 focus:border-ink/10 bg-transparent px-1 text-xs focus:bg-white outline-none"
                      />
                      hrs/wk target
                    </span>
                  </div>
                ) : (
                  m.title && <span className="block text-xs text-sage">{m.title}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canTouch ? (
                <div className="w-28">
                  <CustomSelect
                    value={m.role}
                    onChange={(v) => changeRole(m, v as 'owner' | 'admin' | 'member')}
                    className="text-xs"
                    options={[
                      { value: 'member', label: 'member' },
                      { value: 'admin', label: 'admin' },
                      ...(canManageOwners ? [{ value: 'owner', label: 'owner' }] : []),
                    ]}
                  />
                </div>
              ) : (
                <span className="text-sage">{m.role}</span>
              )}
              {m.status === 'invited' && <span className="text-sage text-xs">invited</span>}
              {m.status === 'invited' && canTouch && (
                <button
                  className="text-xs text-accent disabled:opacity-40"
                  onClick={() => resendInvite(m)}
                  disabled={resendingId === m.id}
                >
                  {resendingId === m.id ? 'Resending…' : 'Resend'}
                </button>
              )}
              {canTouch && (
                <button
                  className="text-xs text-red-600 disabled:opacity-40"
                  onClick={() => removeMember(m)}
                  disabled={removingId === m.id}
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        )
      })}
      </ul>
    </div>
  )
}
