'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import { getInitials, memberName } from '@/lib/agency'

type Member = {
  id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  status: string
  invited_email: string | null
  display_name: string | null
  avatar_url: string | null
}

export default function MembersList({
  members,
  currentUserId,
  canManage,
  canManageOwners,
}: {
  members: Member[]
  currentUserId: string
  canManage: boolean
  canManageOwners: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()
  const [rows, setRows] = useState(members)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // router.refresh() after inviting gives a new `members` array, but useState's initializer
  // only runs on mount — without this, a fresh invite won't show up until a manual reload.
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

  return (
    <ul className="divide-y divide-white/10 rounded border border-white/10">
      {rows.map((m) => {
        const isSelf = m.user_id === currentUserId
        const canTouch = canManage && !isSelf && (m.role !== 'owner' || canManageOwners)
        return (
          <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              {m.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" />
              ) : (
                <div className="h-6 w-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-semibold shrink-0">
                  {getInitials(memberName(m))}
                </div>
              )}
              <span className="truncate">
                {memberName(m)}
                {isSelf && <span className="text-neutral-500"> (you)</span>}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canTouch ? (
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m, e.target.value as 'owner' | 'admin' | 'member')}
                  className="rounded border border-white/10 bg-black/30 px-1.5 py-1 text-xs"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  {canManageOwners && <option value="owner">owner</option>}
                </select>
              ) : (
                <span className="text-neutral-500">{m.role}</span>
              )}
              {m.status === 'invited' && <span className="text-neutral-500 text-xs">invited</span>}
              {canTouch && (
                <button
                  className="text-xs text-red-400 disabled:opacity-40"
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
  )
}
