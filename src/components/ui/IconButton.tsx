'use client'

import { motion, type HTMLMotionProps } from 'motion/react'

const TONES = {
  sage: 'text-sage hover:text-ink hover:bg-sand',
  green: 'text-green hover:bg-green/10',
  red: 'text-red-600 hover:bg-red-600/10',
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
    <motion.button
      type="button"
      title={label}
      aria-label={label}
      whileTap={{ scale: 0.92 }}
      whileHover={{ scale: 1.06 }}
      transition={{ duration: 0.12 }}
      className={`inline-flex items-center justify-center rounded-full p-1.5 text-sm leading-none transition-colors disabled:opacity-40 disabled:pointer-events-none ${TONES[tone]} ${className}`}
      {...props}
    >
      {icon}
    </motion.button>
  )
}
