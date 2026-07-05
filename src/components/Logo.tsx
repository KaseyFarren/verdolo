// Verdolo's mark: a rounded badge in the brand green with a bold "V", plus an orange accent
// underline — the same palette used on the marketing site (verdolo.com) Elementor Kit.
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="9" fill="#1f3320" />
      <path d="M9 10.5L15.1 21.5C15.5 22.2 16.5 22.2 16.9 21.5L23 10.5" stroke="#dd6b2c" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
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
