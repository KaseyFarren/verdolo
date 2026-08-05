// Single source of truth for interactive-control feel (Button, IconButton, the QuickCapture FAB,
// and anything else that should press/lift like the rest of the app). Change values here, not per-component.
export const BUTTON_MOTION = {
  whileTap: { scale: 0.96 },
  whileHover: { scale: 1.03 },
  transition: { duration: 0.15, ease: 'easeOut' },
} as const
