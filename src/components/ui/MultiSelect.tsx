'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SelectOption } from './CustomSelect'

export default function MultiSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Unassigned',
  className = '',
  disabled = false,
  variant = 'pill',
  renderTrigger,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  options?: SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
  /** 'pill' (default) is the filled pill button used in forms. 'plain' is a borderless,
   * text-like trigger for inline-editable table cells (Tasks list row cells). */
  variant?: 'pill' | 'plain'
  /** Overrides the default text-label trigger content (e.g. to show avatars instead). */
  renderTrigger?: (selected: SelectOption[]) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [])

  const selected = options.filter((o) => value.includes(o.value))

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((id) => id !== v) : [...value, v])
  }

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0].label
        : `${selected[0].label} +${selected.length - 1}`

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={
          variant === 'plain'
            ? `flex items-center gap-1 rounded px-1 -mx-1 text-left hover:bg-sand/60 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
            : `w-full flex items-center justify-between gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-sm text-left ${
                disabled ? 'opacity-50 cursor-not-allowed' : ''
              }`
        }
      >
        {renderTrigger ? renderTrigger(selected) : <span className="truncate">{label}</span>}
        {variant === 'pill' && <span className={`text-sage text-xs shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>}
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full min-w-[10rem] max-h-64 overflow-y-auto overflow-x-hidden rounded-xl bg-white shadow-lg border border-ink/10 py-1">
          {options.map((o) => {
            const checked = value.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm min-w-0 ${
                  checked ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-sand'
                }`}
              >
                <span
                  className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                    checked ? 'bg-accent border-accent' : 'border-ink/25'
                  }`}
                >
                  {checked && <span className="text-[9px] text-white">✓</span>}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
