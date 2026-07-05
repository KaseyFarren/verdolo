'use client'

import { motion } from 'motion/react'
import { PERIOD_PRESETS, type Period, type PeriodValue } from '@/lib/period'
import { todayKey } from '@/lib/agency'
import DatePicker from './DatePicker'

export default function PeriodSelector({
  value,
  onChange,
  layoutId,
  presets = PERIOD_PRESETS.map((p) => p.value),
  className = '',
}: {
  value: PeriodValue
  onChange: (v: PeriodValue) => void
  layoutId: string
  presets?: Period[]
  className?: string
}) {
  const items = PERIOD_PRESETS.filter((p) => presets.includes(p.value))

  return (
    <div className={className}>
      <div className="flex gap-1 bg-sand/60 rounded-full p-1 w-fit flex-wrap">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value === 'custom' ? { period: 'custom', start: value.start || todayKey(), end: value.end || todayKey() } : { period: item.value })}
            className={`relative rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
              value.period === item.value ? 'font-medium text-ink' : 'text-sage hover:text-ink'
            }`}
          >
            {value.period === item.value && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-white"
                style={{ boxShadow: 'inset 2px 0 0 0 var(--accent), 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">{item.label}</span>
          </button>
        ))}
      </div>
      {value.period === 'custom' && (
        <div className="flex items-center gap-2 mt-2">
          <DatePicker value={value.start || todayKey()} onChange={(start) => onChange({ period: 'custom', start, end: value.end })} placeholder="From…" className="w-36" />
          <span className="text-sage text-xs">to</span>
          <DatePicker value={value.end || todayKey()} onChange={(end) => onChange({ period: 'custom', start: value.start, end })} placeholder="To…" className="w-36" />
        </div>
      )}
    </div>
  )
}
