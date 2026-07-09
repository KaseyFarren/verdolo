'use client'

import { useState } from 'react'

const PROFIT = '#2a78d6'
const LOSS = '#e05070'

export default function DivergingBarChart({
  items,
  formatValue,
  positiveLabel = 'Profit',
  negativeLabel = 'Loss',
}: {
  items: { id: string; label: string; valueCents: number }[]
  formatValue: (cents: number) => string
  positiveLabel?: string
  negativeLabel?: string
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const maxAbs = Math.max(1, ...items.map((i) => Math.abs(i.valueCents)))

  return (
    <div>
      <div className="space-y-1.5">
        {items.map((item) => {
          const isNegative = item.valueCents < 0
          const pct = (Math.abs(item.valueCents) / maxAbs) * 50
          const isHovered = hoveredId === item.id
          return (
            <button
              key={item.id}
              type="button"
              className="flex items-center w-full gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-sand/40 focus:bg-sand/40 focus:outline-none"
              onPointerEnter={() => setHoveredId(item.id)}
              onPointerLeave={() => setHoveredId((v) => (v === item.id ? null : v))}
              onFocus={() => setHoveredId(item.id)}
              onBlur={() => setHoveredId((v) => (v === item.id ? null : v))}
            >
              <span className="w-20 sm:w-48 shrink-0 truncate text-xs text-ink" title={item.label}>
                {item.label}
              </span>
              <span className="relative flex-1 h-[18px]">
                <span className="absolute left-1/2 top-0 bottom-0 w-px bg-ink/10" />
                {isNegative ? (
                  <span
                    className="absolute top-0 h-full rounded-l-[4px] transition-opacity"
                    style={{
                      right: '50%',
                      width: `${pct}%`,
                      background: LOSS,
                      opacity: isHovered ? 0.85 : 1,
                    }}
                  />
                ) : (
                  <span
                    className="absolute top-0 h-full rounded-r-[4px] transition-opacity"
                    style={{
                      left: '50%',
                      width: `${pct}%`,
                      background: PROFIT,
                      opacity: isHovered ? 0.85 : 1,
                    }}
                  />
                )}
              </span>
              <span className={`w-20 shrink-0 text-right text-xs font-semibold ${isNegative ? 'text-red-600' : 'text-ink'}`}>
                {formatValue(item.valueCents)}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3 mt-3 text-xs text-sage">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: PROFIT }} />
          {positiveLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: LOSS }} />
          {negativeLabel}
        </span>
      </div>
    </div>
  )
}
