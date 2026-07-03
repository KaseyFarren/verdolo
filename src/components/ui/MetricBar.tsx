export default function MetricBar({ value, max, display }: { value: number; max: number; display: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="relative h-9 rounded-lg bg-sand overflow-hidden min-w-[84px]">
      <div className="absolute inset-y-0 left-0 bg-accent/25" style={{ width: `${pct}%` }} />
      <div className="relative h-full flex items-center px-2.5 text-xs font-semibold text-ink whitespace-nowrap">{display}</div>
    </div>
  )
}
