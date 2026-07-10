'use client'

import { motion, type HTMLMotionProps } from 'motion/react'

const TONES = {
  sage: 'text-sage hover:text-ink hover:bg-sand',
  green: 'text-green hover:bg-green/10',
  red: 'text-red-600 hover:bg-red-600/10',
  accent: 'text-accent hover:bg-accent/10',
} as const

export default function IconButton({
  icon,
  label,
  tone = 'sage',
  className = '',
  ...props
}: {
  icon: React.ReactNode
  label: string
  tone?: keyof typeof TONES
  className?: string
} & Omit<HTMLMotionProps<'button'>, 'ref'>) {
  return (
    <span className="relative inline-flex group/tip">
      <motion.button
        type="button"
        aria-label={label}
        whileTap={{ scale: 0.92 }}
        whileHover={{ scale: 1.06 }}
        transition={{ duration: 0.12 }}
        className={`inline-flex items-center justify-center rounded-full p-1.5 text-sm leading-none transition-colors disabled:opacity-40 disabled:pointer-events-none ${TONES[tone]} ${className}`}
        {...props}
      >
        {icon}
      </motion.button>
      {/* app-styled hover tooltip - a delay before showing avoids flashing on quick mouse passes;
          pointer-events-none so it never intercepts the click meant for the button underneath */}
      <span className="pointer-events-none absolute -top-1.5 left-1/2 -translate-x-1/2 -translate-y-full z-30 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-cream opacity-0 transition-opacity delay-500 group-hover/tip:opacity-100">
        {label}
      </span>
    </span>
  )
}
