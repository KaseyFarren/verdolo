export default function Card({
  className = '',
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={`rounded-lg border border-white/10 bg-white/5 p-4 ${className}`}>{children}</div>
}
