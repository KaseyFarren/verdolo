'use client'

import { useState } from 'react'

export default function QuickAddTime({ onAdd }: { onAdd: (hours: number) => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  function close() {
    setOpen(false)
    setValue('')
  }

  async function confirm() {
    const hours = parseFloat(value)
    if (!hours || hours <= 0) return
    setSaving(true)
    await onAdd(hours)
    setSaving(false)
    close()
  }

  if (!open) {
    return (
      <button title="Log time manually" className="text-xs text-sage px-1" onClick={() => setOpen(true)}>
        +h
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min="0"
        step="0.25"
        autoFocus
        placeholder="hrs"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirm()
          if (e.key === 'Escape') close()
        }}
        className="w-12 rounded border border-ink/10 bg-white px-1 py-0.5 text-xs"
      />
      <button title="Save" className="text-xs text-green px-0.5 disabled:opacity-40" onClick={confirm} disabled={saving}>
        ✓
      </button>
      <button title="Cancel" className="text-xs text-sage px-0.5" onClick={close} disabled={saving}>
        ✕
      </button>
    </span>
  )
}
