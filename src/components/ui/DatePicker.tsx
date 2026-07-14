'use client'

import { useEffect, useRef, useState } from 'react'
import { formatDate, todayKey } from '@/lib/agency'

export default function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date…',
  className = '',
  variant = 'pill',
  allowClear = true,
  min,
  max,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  /** 'pill' (default) is the filled pill button used in toolbars/forms. 'plain' is a
   * borderless, text-like trigger for inline-editable table cells (Tasks list row cells). */
  variant?: 'pill' | 'plain'
  allowClear?: boolean
  /** Optional inclusive YYYY-MM-DD bounds; days outside are shown disabled. */
  min?: string
  max?: string
}) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState((value || todayKey()).slice(0, 7))
  const ref = useRef<HTMLDivElement>(null)

  function toggleOpen() {
    setOpen((v) => {
      if (!v) setViewMonth((value || todayKey()).slice(0, 7))
      return !v
    })
  }

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

  const today = todayKey()
  const [y, m] = viewMonth.split('-').map(Number)
  const jsMonth = m - 1
  const firstDay = new Date(y, jsMonth, 1).getDay()
  const daysInMonth = new Date(y, jsMonth + 1, 0).getDate()

  function prevMonth() {
    const d = new Date(y, jsMonth - 1, 1)
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  function nextMonth() {
    const d = new Date(y, jsMonth + 1, 1)
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  function select(k: string) {
    onChange(k)
    setOpen(false)
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggleOpen}
        className={
          variant === 'plain'
            ? 'block w-full rounded px-1 -mx-1 text-left hover:bg-sand/60'
            : 'w-full flex items-center justify-between gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-sm text-left'
        }
      >
        <span className={`block truncate ${value ? '' : 'text-sage'}`}>{value ? formatDate(value) : placeholder}</span>
        {variant === 'pill' && <span className={`text-sage text-xs shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-xl bg-white shadow-lg border border-ink/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth} className="text-sage px-2 rounded-full">
              ‹
            </button>
            <div className="text-sm font-medium">{new Date(y, jsMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
            <button type="button" onClick={nextMonth} className="text-sage px-2 rounded-full">
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className="text-center text-xs text-sage py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array(firstDay)
              .fill(null)
              .map((_, i) => (
                <div key={'e' + i} />
              ))}
            {Array(daysInMonth)
              .fill(null)
              .map((_, i) => {
                const d = i + 1
                const k = `${y}-${String(jsMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                const isToday = k === today
                const isSel = k === value
                const disabled = (min && k < min) || (max && k > max)
                return (
                  <button
                    type="button"
                    key={d}
                    disabled={!!disabled}
                    onClick={() => select(k)}
                    className={`text-center py-1.5 rounded-full text-sm ${
                      disabled
                        ? 'text-sage/30 cursor-not-allowed'
                        : isSel
                          ? 'bg-accent text-white font-semibold'
                          : isToday
                            ? 'bg-ink/5 text-accent font-medium'
                            : 'hover:bg-sand'
                    }`}
                  >
                    {d}
                  </button>
                )
              })}
          </div>
          {value && allowClear && (
            <button type="button" className="mt-2 text-xs text-sage hover:text-ink" onClick={() => select('')}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
