'use client'

import { useState } from 'react'

const WIDTH = 640
const HEIGHT = 220
const PAD_LEFT = 56
const PAD_RIGHT = 16
const PAD_TOP = 16
const PAD_BOTTOM = 28

function niceStep(roughStep: number) {
  const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep || 1)))
  const frac = roughStep / pow10
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return niceFrac * pow10
}

function niceTicks(max: number, count: number) {
  if (max <= 0) return [0]
  const step = niceStep(max / count)
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= end + step / 2; v += step) ticks.push(Math.round(v))
  return ticks
}

export default function BarChart({
  labels,
  values,
  formatValue,
  color = 'var(--accent)',
}: {
  labels: string[]
  values: number[]
  formatValue: (value: number) => string
  color?: string
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const max = Math.max(1, ...values)
  const ticks = niceTicks(max, 4)
  const scaleMax = ticks[ticks.length - 1] || 1

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const n = Math.max(1, labels.length)
  const slot = plotW / n
  const barW = Math.min(40, slot * 0.55)

  function xAt(i: number) {
    return PAD_LEFT + slot * i + slot / 2
  }
  function yAt(v: number) {
    const t = v / scaleMax
    return PAD_TOP + plotH - t * plotH
  }

  // Thin out x-axis labels so they don't collide when there are many bars (e.g. 26 weeks).
  const labelStride = Math.max(1, Math.ceil(labels.length / 10))

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto touch-none min-w-[420px]"
          onPointerLeave={() => setHoverIdx(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yAt(t)} y2={yAt(t)} stroke="#e1e0d9" strokeWidth={1} />
              <text x={PAD_LEFT - 8} y={yAt(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#898781">
                {formatValue(t)}
              </text>
            </g>
          ))}

          {labels.map((label, i) => {
            if (i % labelStride !== 0 && i !== labels.length - 1) return null
            return (
              <text key={label + i} x={xAt(i)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="#898781">
                {label}
              </text>
            )
          })}

          {values.map((v, i) => {
            const h = Math.max(0, yAt(0) - yAt(v))
            return (
              <rect
                key={i}
                x={xAt(i) - barW / 2}
                y={yAt(v)}
                width={barW}
                height={h}
                rx={3}
                fill={color}
                opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.5}
                onPointerEnter={() => setHoverIdx(i)}
              />
            )
          })}
        </svg>
      </div>

      {hoverIdx !== null && (
        <div
          className="absolute top-0 rounded-lg bg-white shadow-lg border border-ink/10 px-3 py-2 text-xs pointer-events-none"
          style={{
            left: `${Math.min(85, Math.max(0, (xAt(hoverIdx) / WIDTH) * 100))}%`,
            transform: xAt(hoverIdx) / WIDTH > 0.7 ? 'translateX(-100%)' : undefined,
          }}
        >
          <div className="font-semibold text-ink mb-1">{labels[hoverIdx]}</div>
          <div className="text-ink font-semibold">{formatValue(values[hoverIdx])}</div>
        </div>
      )}
    </div>
  )
}
