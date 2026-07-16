// Verdolo's mark: a rounded badge in the brand green with a heavy Syne "V" in the
// orange accent - the same palette used on the marketing site (verdolo.com).
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="9" fill="#1f3320" />
      <g transform="translate(7.04,10.88) scale(0.016)">
        <path
          d="M408 0 20 640H302L633 25H531L862 640H1140L756 0Z"
          fill="#dd6b2c"
          transform="translate(-20,640) scale(1,-1)"
        />
      </g>
    </svg>
  )
}

export default function Logo({ size = 22, showWordmark = true }: { size?: number; showWordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size * 1.6} />
      {showWordmark && (
        <span className="font-heading font-extrabold text-ink" style={{ fontSize: size }}>
          Verdolo
        </span>
      )}
    </span>
  )
}
