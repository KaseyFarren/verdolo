'use client'

import { useState } from 'react'
import IconButton from '@/components/ui/IconButton'
import { CheckIcon, PlusHourIcon, XIcon } from '@/components/ui/icons'

export default function QuickAddTime({ onAdd, onOpenChange }: { onAdd: (hours: number) => void | Promise<void>; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  function openInput() {
    setOpen(true)
    onOpenChange?.(true)
  }
  function close() {
    setOpen(false)
    setValue('')
    onOpenChange?.(false)
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
    return <IconButton label="Log time manually" tone="sage" icon={<PlusHourIcon />} onClick={openInput} />
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
        className="w-12 rounded border border-ink/10 bg-white px-1.5 py-1 text-sm"
      />
      <IconButton label="Save" tone="green" icon={<CheckIcon />} onClick={confirm} disabled={saving} />
      <IconButton label="Cancel" tone="sage" icon={<XIcon />} onClick={close} disabled={saving} />
    </span>
  )
}
