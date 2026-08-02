'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import Button from '@/components/ui/Button'

type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<(v: boolean) => void>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts)
    return new Promise((resolve) => {
      resolver.current = resolve
    })
  }, [])

  function respond(value: boolean) {
    setOptions(null)
    resolver.current?.(value)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {options && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => respond(false)}
          >
            <motion.div
              className="w-full max-w-sm rounded-lg border border-ink/10 bg-white p-5 shadow-xl"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
            >
              {options.title && <div className="text-sm font-semibold mb-1.5">{options.title}</div>}
              <div className="text-sm text-sage mb-5">{options.message}</div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => respond(false)}>
                  {options.cancelLabel ?? 'Cancel'}
                </Button>
                <Button
                  variant={options.danger ? 'primary' : 'primary'}
                  className={options.danger ? '!bg-red-600 !text-white hover:!bg-red-600' : ''}
                  onClick={() => respond(true)}
                >
                  {options.confirmLabel ?? 'Confirm'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  )
}
