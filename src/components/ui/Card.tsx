// The one shape a content section takes anywhere in the app - rounded-2xl, white, hairline
// border, no shadow (shadows are reserved for buttons - see motion.ts / Button.tsx).
export default function Card({
  className = '',
  children,
  ...props
}: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl bg-white border border-ink/8 p-5 ${className}`} {...props}>
      {children}
    </div>
  )
}
