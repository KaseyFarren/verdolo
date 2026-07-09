'use client'

import { useRef, useState } from 'react'

export type TrendSeries = {
  key: string
  label: string
  color: string
  values: number[]
  // Per-point marker color override (e.g. above/below a target) - the connecting line still
  // uses `color`, only the dots pick this up. Same length as `values` when provided.
  pointColors?: string[]
}

const WIDTH = 640
const HEIGHT = 220
const PAD_LEFT = 56
const PAD_RIGHT = 64
const PAD_TOP = 16
const PAD_BOTTOM = 28

// Picks a "clean" step (1/2/5 × a power of ten) so axis ticks read as round numbers.
function niceStep(roughStep: number) {
  const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const frac = roughStep / pow10
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return niceFrac * pow10
}

function niceTicks(min: number, max: number, count: number) {
  if (min === max) return [min]
  const step = niceStep((max - min) / count)
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v))
  return ticks
}

function monthTick(monthKey: string) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })
}

export default function TrendLineChart({
  months,
  series,
  formatValue,
  referenceLine,
}: {
  months: string[]
  series: TrendSeries[]
  formatValue: (cents: number) => string
  referenceLine?: { value: number; label: string }
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const allValues = [...series.flatMap((s) => s.values), ...(referenceLine ? [referenceLine.value] : [])]
  const yMin = Math.min(0, ...allValues)
  const yMax = Math.max(1, ...allValues)
  const ticks = niceTicks(yMin, yMax, 4)
  const scaleMin = ticks[0]
  const scaleMax = ticks[ticks.length - 1]

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM

  function xAt(i: number) {
    return months.length <= 1 ? PAD_LEFT + plotW / 2 : PAD_LEFT + (i / (months.length - 1)) * plotW
  }
  function yAt(v: number) {
    const t = (v - scaleMin) / (scaleMax - scaleMin || 1)
    return PAD_TOP + plotH - t * plotH
  }

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH
    const i = Math.round(((relX - PAD_LEFT) / plotW) * (months.length - 1))
    setHoverIdx(Math.min(months.length - 1, Math.max(0, i)))
  }

  return (
    <div className="relative">
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-xs text-sage">
              <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </div>
          ))}
        </div>
      )}

      {/* viewBox scaling shrinks the SVG's fixed fontSize labels along with the geometry -
          on a narrow phone the plot area can drop below half its natural width, making 10-11px
          axis/end labels unreadably small. min-w keeps a readable floor; overflow-x-auto lets
          the chart scroll horizontally instead of shrinking past that floor. */}
      <div className="overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto touch-none min-w-[420px]"
        onPointerMove={onMove}
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

        {months.map((m, i) => (
          <text key={m} x={xAt(i)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="#898781">
            {monthTick(m)}
          </text>
        ))}

        {referenceLine && (
          <g>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yAt(referenceLine.value)}
              y2={yAt(referenceLine.value)}
              stroke="#898781"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text x={PAD_LEFT + 4} y={yAt(referenceLine.value) - 5} fontSize={10} fill="#898781">
              {referenceLine.label}
            </text>
          </g>
        )}

        {hoverIdx !== null && (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={PAD_TOP}
            y2={PAD_TOP + plotH}
            stroke="#c3c2b7"
            strokeWidth={1}
          />
        )}

        {series.map((s) => {
          const points = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')
          return (
            <g key={s.key}>
              <polyline points={points} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {s.values.map((v, i) => {
                const dotColor = s.pointColors?.[i] ?? s.color
                return (
                  <g key={i}>
                    <circle cx={xAt(i)} cy={yAt(v)} r={i === hoverIdx ? 6 : 5} fill="#fff" />
                    <circle cx={xAt(i)} cy={yAt(v)} r={i === hoverIdx ? 4.5 : 3.5} fill={dotColor} />
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* End labels, nudged apart top-to-bottom so converging lines don't overlap (marks-and-anatomy.md). */}
        {(() => {
          const lastIdx = months.length - 1
          const MIN_GAP = 13
          const labels = series
            .map((s) => ({ key: s.key, text: formatValue(s.values[lastIdx]), y: yAt(s.values[lastIdx]) }))
            .sort((a, b) => a.y - b.y)
          for (let i = 1; i < labels.length; i++) {
            if (labels[i].y - labels[i - 1].y < MIN_GAP) labels[i].y = labels[i - 1].y + MIN_GAP
          }
          const byKey = new Map(labels.map((l) => [l.key, l]))
          return series.map((s) => {
            const label = byKey.get(s.key)!
            return (
              <text key={s.key} x={xAt(lastIdx) + 8} y={label.y} dominantBaseline="middle" fontSize={11} fontWeight={600} fill="#1a1a17">
                {label.text}
              </text>
            )
          })
        })()}
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
          <div className="font-semibold text-ink mb-1">{monthTick(months[hoverIdx])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 justify-between">
              <span className="flex items-center gap-1.5 text-sage">
                <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ background: s.pointColors?.[hoverIdx] ?? s.color }} />
                {s.label}
              </span>
              <span className="font-semibold text-ink ml-3">{formatValue(s.values[hoverIdx])}</span>
            </div>
          ))}
          {referenceLine && (
            <div className="flex items-center gap-1.5 justify-between mt-1 pt-1 border-t border-ink/10">
              <span className="flex items-center gap-1.5 text-sage">
                <span className="inline-block w-2.5 h-0.5 rounded-full border-t border-dashed border-sage" style={{ background: 'transparent' }} />
                {referenceLine.label}
              </span>
              <span className="font-semibold text-ink ml-3">{formatValue(referenceLine.value)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
