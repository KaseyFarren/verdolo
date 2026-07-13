'use client'

import { useEffect, useRef, useState } from 'react'
import { todayKey } from '@/lib/agency'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(value: string) {
  const [y, m] = value.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Same look and interaction model as DatePicker (rounded trigger + popover card), scoped to
// picking a month/year instead of a day - swaps in for the browser's native <input type="month">,
// which renders with the OS's own calendar chrome instead of the app's design system.
export default function MonthPicker({
  value,
  onChange,
  placeholder = 'Pick a month…',
  className = '',
  disableFuture = false,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  // Mirrors a "next month" arrow elsewhere on the page that stops at the current month - without
  // this the grid popup let you click straight past that same boundary, a contradiction between
  // the two controls for picking the exact same value.
  disableFuture?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(Number((value || todayKey()).slice(0, 4)))
  const ref = useRef<HTMLDivElement>(null)

  function toggleOpen() {
    setOpen((v) => {
      if (!v) setViewYear(Number((value || todayKey()).slice(0, 4)))
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

  const [selY, selM] = value ? value.split('-').map(Number) : [null, null]
  const [todayY, todayM] = todayKey().slice(0, 7).split('-').map(Number)

  function select(monthIndex: number) {
    onChange(`${viewYear}-${String(monthIndex + 1).padStart(2, '0')}`)
    setOpen(false)
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center justify-between gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-sm text-left"
      >
        <span className={`truncate ${value ? '' : 'text-sage'}`}>{value ? monthLabel(value) : placeholder}</span>
        <span className={`text-sage text-xs shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-xl bg-white shadow-lg border border-ink/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setViewYear((y) => y - 1)} className="text-sage px-2 rounded-full">
              ‹
            </button>
            <div className="text-sm font-medium">{viewYear}</div>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              disabled={disableFuture && viewYear >= todayY}
              className="text-sage px-2 rounded-full disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((label, i) => {
              const isToday = viewYear === todayY && i + 1 === todayM
              const isSel = viewYear === selY && i + 1 === selM
              const isFuture = disableFuture && (viewYear > todayY || (viewYear === todayY && i + 1 > todayM))
              return (
                <button
                  type="button"
                  key={label}
                  onClick={() => select(i)}
                  disabled={isFuture}
                  className={`text-center py-2 rounded-full text-sm disabled:opacity-30 disabled:hover:bg-transparent ${
                    isSel ? 'bg-accent text-white font-semibold' : isToday ? 'bg-ink/5 text-accent font-medium' : 'hover:bg-sand'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
