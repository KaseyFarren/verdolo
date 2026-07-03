'use client'

import { useEffect, useRef, useState } from 'react'

export type SelectOption = { value: string; label: string }
export type SelectGroup = { label: string; options: SelectOption[] }

export default function CustomSelect({
  value,
  onChange,
  options = [],
  groups = [],
  placeholder = 'Select…',
  className = '',
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  options?: SelectOption[]
  groups?: SelectGroup[]
  placeholder?: string
  className?: string
  disabled?: boolean
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

  const all = [...options, ...groups.flatMap((g) => g.options)]
  const current = all.find((o) => o.value === value)

  function select(v: string) {
    onChange(v)
    setOpen(false)
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`w-full flex items-center justify-between gap-2 rounded border border-ink/10 bg-white px-2 py-1.5 text-sm text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <span className="truncate">{current?.label ?? placeholder}</span>
        <span className={`text-sage text-[10px] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full min-w-[10rem] max-h-64 overflow-y-auto rounded-xl bg-white shadow-lg border border-ink/10 py-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => select(o.value)}
              className={`w-full text-left px-3 py-1.5 text-sm whitespace-nowrap ${
                o.value === value ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-sand'
              }`}
            >
              {o.label}
            </button>
          ))}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-sage">{g.label}</div>
              {g.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => select(o.value)}
                  className={`w-full text-left px-3 py-1.5 text-sm whitespace-nowrap ${
                    o.value === value ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-sand'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
