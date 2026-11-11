'use client'

/** App-styled on/off switch (instead of a native checkbox), with an optional label + hint. */
export default function Switch({
  checked,
  onChange,
  disabled,
  label,
  hint,
  className = '',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: React.ReactNode
  hint?: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`flex items-start gap-2.5 text-left outline-none focus:outline-none ${disabled ? 'opacity-50 cursor-default' : 'cursor-pointer'} ${className}`}
    >
      <span className={`mt-0.5 w-9 h-5 rounded-full relative shrink-0 transition-colors ${checked ? 'bg-accent' : 'bg-ink/15'}`}>
        <span className={`absolute top-[3px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[19px]' : 'left-[3px]'}`} />
      </span>
      {(label || hint) && (
        <span className="text-sm leading-snug">
          {label}
          {hint && <span className="block text-xs text-sage">{hint}</span>}
        </span>
      )}
    </button>
  )
}
