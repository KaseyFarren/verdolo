export default function Card({
  className = '',
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={`rounded-2xl bg-white shadow-md p-5 ${className}`}>{children}</div>
}
