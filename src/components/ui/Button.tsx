'use client'

import { motion, type HTMLMotionProps } from 'motion/react'

const VARIANTS = {
  primary: 'bg-white text-black font-medium hover:bg-white/90',
  secondary: 'border border-white/10 text-neutral-200 hover:bg-white/5 hover:border-white/20',
  ghost: 'text-neutral-400 hover:text-white',
  danger: 'text-red-400 hover:text-red-300',
} as const

const SIZES = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-sm',
} as const

export default function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  className?: string
  children: React.ReactNode
} & Omit<HTMLMotionProps<'button'>, 'ref'>) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      whileHover={{ scale: 1.015 }}
      transition={{ duration: 0.12 }}
      className={`rounded-md transition-colors disabled:opacity-40 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  )
}
