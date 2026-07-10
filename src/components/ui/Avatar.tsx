import { AVATAR_COLORS, getInitials, memberName } from '@/lib/agency'

type Member = { user_id: string; invited_email: string | null; display_name?: string | null; avatar_url?: string | null }

export default function Avatar({ member, size = 20, className = '' }: { member?: Member | null; size?: number; className?: string }) {
  const name = memberName(member)
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.4) }
  if (member?.avatar_url) {
    return <img src={member.avatar_url} alt={name} className={`rounded-full object-cover shrink-0 ${className}`} style={style} />
  }
  const colorIndex = member ? Math.abs(hashCode(member.user_id)) % AVATAR_COLORS.length : 0
  return (
    <div
      title={name}
      className={`rounded-full flex items-center justify-center font-bold text-white shrink-0 ${className}`}
      style={{ ...style, background: AVATAR_COLORS[colorIndex] }}
    >
      {getInitials(name)}
    </div>
  )
}

function hashCode(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return h
}
