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
  title: string | null
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

  async function saveTitle(m: Member, title: string) {
    const trimmed = title.trim() || null
    if (trimmed === m.title) return
    const { data } = await supabase.from('org_members').update({ title: trimmed }).eq('id', m.id).select().single()
    if (data) setRows((prev) => prev.map((r) => (r.id === m.id ? (data as Member) : r)))
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
    <ul className="divide-y divide-white/10 rounded border border-ink/10">
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
                <div className="h-6 w-6 rounded-full bg-ink/5 flex items-center justify-center text-[10px] font-semibold shrink-0">
                  {getInitials(memberName(m))}
                </div>
              )}
              <div className="min-w-0">
                <span className="truncate">
                  {memberName(m)}
                  {isSelf && <span className="text-sage"> (you)</span>}
                </span>
                {canManage ? (
                  <input
                    defaultValue={m.title ?? ''}
                    placeholder="Add role/title…"
                    onBlur={(e) => saveTitle(m, e.target.value)}
                    className="block w-32 rounded border border-transparent hover:border-ink/10 focus:border-ink/10 bg-transparent px-1 -mx-1 text-xs text-sage focus:bg-white outline-none"
                  />
                ) : (
                  m.title && <span className="block text-xs text-sage">{m.title}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canTouch ? (
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m, e.target.value as 'owner' | 'admin' | 'member')}
                  className="rounded border border-ink/10 bg-white px-1.5 py-1 text-xs"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  {canManageOwners && <option value="owner">owner</option>}
                </select>
              ) : (
                <span className="text-sage">{m.role}</span>
              )}
              {m.status === 'invited' && <span className="text-sage text-xs">invited</span>}
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
  )
}
