export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="text-xs font-semibold uppercase tracking-wide text-sage mb-2">{label}</div>
      <div className="rounded-lg border border-ink/10 bg-white p-4">{children}</div>
    </div>
  )
}

export function Row({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode
  subtitle: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-ink/10 last:border-b-0 last:pb-0 first:pt-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-sage mt-0.5">{subtitle}</div>
      </div>
      {children}
    </div>
  )
}

export function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      className={`w-10 h-[22px] rounded-full relative shrink-0 transition-colors ${checked ? 'bg-white' : 'bg-ink/5'} ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
    >
      <div className={`absolute top-[3px] h-4 w-4 rounded-full bg-black transition-all ${checked ? 'left-[20px]' : 'left-[3px]'}`} />
    </div>
  )
}

export function triggerDownload(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
