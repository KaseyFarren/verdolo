'use client'

export default function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex items-center group">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 max-w-[min(240px,90vw)] -translate-x-1/2 text-center rounded-md bg-ink px-2 py-1 text-xs text-white opacity-0 shadow-md transition-opacity duration-0 delay-0 group-hover:opacity-100 group-hover:duration-150 group-hover:delay-[2000ms]"
      >
        {content}
      </span>
    </span>
  )
}
