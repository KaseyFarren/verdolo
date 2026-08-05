'use client'

import { motion, type HTMLMotionProps } from 'motion/react'
import { BUTTON_MOTION } from './motion'

const VARIANTS = {
  primary: 'bg-accent text-white font-medium shadow-md hover:brightness-110',
  secondary: 'border border-ink/15 text-ink hover:bg-sand',
  ghost: 'text-sage hover:text-ink',
  danger: 'text-red-600 hover:text-red-700',
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
      {...BUTTON_MOTION}
      className={`rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  )
}
