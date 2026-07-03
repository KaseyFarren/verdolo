'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import Button from '@/components/ui/Button'

// Lightweight per-device app-lock — like a phone lock screen, not a real auth replacement.
// Supabase login is what actually protects the data; this just deters a shoulder-surf or
// someone picking up an unattended, already-logged-in laptop. Everything lives in
// localStorage: nothing here is synced across devices or verified server-side.

const PIN_HASH_KEY = 'ah_pin_hash'
const LAST_ACTIVITY_KEY = 'ah_last_activity'
const LOCKED_KEY = 'ah_locked'
const IDLE_MINUTES_KEY = 'ah_idle_minutes'
const DEFAULT_IDLE_MINUTES = 5

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function getIdleMinutes() {
  if (typeof window === 'undefined') return DEFAULT_IDLE_MINUTES
  return Number(localStorage.getItem(IDLE_MINUTES_KEY)) || DEFAULT_IDLE_MINUTES
}

export function setIdleMinutes(minutes: number) {
  localStorage.setItem(IDLE_MINUTES_KEY, String(minutes))
}

export function hasPinSet() {
  if (typeof window === 'undefined') return false
  return !!localStorage.getItem(PIN_HASH_KEY)
}

export async function setPin(pin: string) {
  localStorage.setItem(PIN_HASH_KEY, await sha256Hex(pin))
}

export function clearPin() {
  localStorage.removeItem(PIN_HASH_KEY)
  localStorage.removeItem(LOCKED_KEY)
}

type PinLockContextValue = { hasPin: boolean; lock: () => void }
const PinLockContext = createContext<PinLockContextValue | null>(null)

export function usePinLock() {
  const ctx = useContext(PinLockContext)
  if (!ctx) throw new Error('usePinLock must be used within PinLockProvider')
  return ctx
}

export function PinLockProvider({ children }: { children: React.ReactNode }) {
  const [pinHash, setPinHash] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [entry, setEntry] = useState('')
  const [error, setError] = useState(false)
  const lastWrite = useRef(0)

  useEffect(() => {
    const hash = localStorage.getItem(PIN_HASH_KEY)
    setPinHash(hash)
    if (!hash) return
    const forced = localStorage.getItem(LOCKED_KEY) === '1'
    const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now()
    const idleExpired = Date.now() - last > getIdleMinutes() * 60000
    if (forced || idleExpired) setLocked(true)
  }, [])

  useEffect(() => {
    if (!pinHash) return

    function bump() {
      const now = Date.now()
      // throttle localStorage writes to once every 10s — this fires on every mousemove otherwise
      if (now - lastWrite.current > 10000) {
        lastWrite.current = now
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
      }
    }
    window.addEventListener('mousemove', bump)
    window.addEventListener('keydown', bump)
    window.addEventListener('click', bump)

    const iv = setInterval(() => {
      const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now()
      if (Date.now() - last > getIdleMinutes() * 60000) {
        localStorage.setItem(LOCKED_KEY, '1')
        setLocked(true)
      }
    }, 5000)

    return () => {
      window.removeEventListener('mousemove', bump)
      window.removeEventListener('keydown', bump)
      window.removeEventListener('click', bump)
      clearInterval(iv)
    }
  }, [pinHash])

  async function submit() {
    const hash = await sha256Hex(entry)
    if (hash === pinHash) {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
      localStorage.removeItem(LOCKED_KEY)
      setLocked(false)
      setEntry('')
      setError(false)
    } else {
      setError(true)
      setEntry('')
    }
  }

  function lock() {
    if (!pinHash) return
    localStorage.setItem(LOCKED_KEY, '1')
    setLocked(true)
  }

  return (
    <PinLockContext.Provider value={{ hasPin: !!pinHash, lock }}>
      {children}
      <AnimatePresence>
        {locked && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-green-deep text-cream"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-xs text-center"
            >
              <div className="text-3xl mb-3">🔒</div>
              <div className="text-sm text-cream/70 mb-4">Enter your PIN to continue</div>
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={entry}
                onChange={(e) => {
                  setError(false)
                  setEntry(e.target.value.replace(/\D/g, ''))
                }}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className={`w-full text-center text-2xl tracking-[0.5em] rounded-lg border bg-white/10 text-cream px-3 py-3 mb-3 focus:outline-none ${
                  error ? 'border-red-400' : 'border-cream/20 focus:ring-1 focus:ring-accent'
                }`}
              />
              {error && <div className="text-xs text-red-400 mb-3">Incorrect PIN</div>}
              <Button variant="primary" className="w-full" onClick={submit} disabled={!entry}>
                Unlock
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PinLockContext.Provider>
  )
}
