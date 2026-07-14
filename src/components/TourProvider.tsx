'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { stepsForRole, tourReplayKey, tourStepKey, type Role, type TourStep } from '@/lib/tour'
import { XIcon } from '@/components/ui/icons'

const PAD = 14 // gap between the card and page content
const HOLE = 6 // padding around the spotlight cutout
const CARD_W = 300

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

type Rect = { top: number; left: number; width: number; height: number }

// Mounted once in AppShell for every role. Activates either as the owner's automatic first-run tour
// or via replay (any role, from Settings). Instead of a blocking overlay it uses a box-shadow
// "spotlight" - the page stays fully interactive, the cutout is rounded, and the guide card is
// placed in whatever margin is free so it never covers page content. Progress lives in localStorage
// so it survives the hard navigation between steps that live on different pages; same-page steps
// transition softly so an in-flight save isn't aborted by a reload.
export default function TourProvider({ orgId, role }: { orgId: string; role?: Role }) {
  const pathname = usePathname()
  const [active, setActive] = useState(false)
  const [isReplay, setIsReplay] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const checkedRef = useRef(false)

  const steps = useMemo(() => (role ? stepsForRole(role) : []), [role])
  const step: TourStep | undefined = active ? steps[stepIndex] : undefined

  useEffect(() => {
    if (!role || checkedRef.current) return
    checkedRef.current = true
    const stored = Number(localStorage.getItem(tourStepKey(orgId)) ?? '0')
    const initial = Number.isInteger(stored) && stored >= 0 ? stored : 0

    if (localStorage.getItem(tourReplayKey(orgId)) === '1') {
      setIsReplay(true)
      setStepIndex(initial)
      setActive(true)
      return
    }
    if (role !== 'owner') return
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data: org } = await supabase.from('orgs').select('onboarding_tour_completed_at').eq('id', orgId).maybeSingle()
      if (!cancelled && !org?.onboarding_tour_completed_at) {
        setStepIndex(initial)
        setActive(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, role])

  const finish = useCallback(async () => {
    setActive(false)
    localStorage.removeItem(tourStepKey(orgId))
    localStorage.removeItem(tourReplayKey(orgId))
    if (!isReplay && role === 'owner') {
      await fetch('/api/onboarding/complete-tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
    }
  }, [orgId, isReplay, role])

  // Advance to an index. Same-page steps transition softly (no reload, so an in-flight optimistic
  // save isn't cut off); cross-page steps hard-navigate. The current pathname is captured so a
  // stale closure can't misroute after navigation.
  const goToStep = useCallback(
    (index: number) => {
      if (index >= steps.length) {
        finish()
        return
      }
      if (index < 0) return
      localStorage.setItem(tourStepKey(orgId), String(index))
      // Soft-transition only when the FULL destination (including any ?view= query) matches where
      // we already are - otherwise a step that just changes the query (e.g. Profile -> General
      // settings tab) would stay on the wrong tab, never find its anchor, and appear to skip. A
      // differing pathname OR query means a real navigation.
      const currentFull = pathname + (typeof window !== 'undefined' ? window.location.search : '')
      if (steps[index].path === currentFull) {
        setRect(null)
        setStepIndex(index)
      } else {
        window.location.assign(steps[index].path)
      }
    },
    [steps, pathname, orgId, finish]
  )

  // Track the spotlight + card position for the current step, and wire auto-advance.
  useEffect(() => {
    if (!active || !step) return
    if (step.path.split('?')[0] !== pathname) return // wrong page; a hard nav will remount us here

    // Reserve the right rail so page content reflows out from under the card.
    document.body.classList.add('tour-active')

    let raf = 0
    let cancelled = false
    let advanced = false

    // Card lives in a fixed rail (right on desktop, bottom on mobile) that page content reflows
    // away from (see body.tour-active in globals.css), so it never covers a real element. Vertical
    // position tracks the spotlight so the guidance stays next to what it's describing.
    function positionCard(target: Rect | null) {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const cardH = cardRef.current?.offsetHeight || 220
      if (vw < 768) {
        setCardPos({ left: clamp((vw - CARD_W) / 2, PAD, vw - CARD_W - PAD), top: vh - cardH - PAD })
        return
      }
      const left = vw - 30 - CARD_W
      const top = target ? clamp(target.top + target.height / 2 - cardH / 2, PAD, vh - cardH - PAD) : clamp(vh / 2 - cardH / 2, PAD, vh - cardH - PAD)
      setCardPos({ left, top })
    }

    // No selector => card only, no spotlight (intro / outro).
    if (!step.selector) {
      setRect(null)
      positionCard(null)
      return () => {
        document.body.classList.remove('tour-active')
      }
    }

    let waited = 0
    let marked: Element | null = null
    function loop() {
      if (cancelled) return
      const el = document.querySelector(step!.selector)
      if (el) {
        // Flag the spotlighted element so CSS can force-show controls that are otherwise
        // hover-only (the task row's snooze/skip cluster).
        if (marked !== el) {
          marked?.removeAttribute('data-tour-active')
          el.setAttribute('data-tour-active', '')
          marked = el
        }
        const r = el.getBoundingClientRect()
        const target = { top: r.top, left: r.left, width: r.width, height: r.height }
        setRect(target)
        positionCard(target)
      } else {
        // Anchor absent (e.g. "complete a task" with no tasks). Give it a moment, then skip ahead.
        waited += 16
        if (waited > 2500 && !advanced) {
          advanced = true
          goToStep(stepIndex + 1)
          return
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // Auto-advance when the user performs the step's action. Delay the hop so the optimistic save
    // and its DB write settle before any page navigation.
    function onDocClick(e: MouseEvent) {
      if (advanced || !step!.advanceOn) return
      if ((e.target as Element)?.closest(step!.advanceOn)) {
        advanced = true
        setTimeout(() => {
          if (!cancelled) goToStep(stepIndex + 1)
        }, 800)
      }
    }
    document.addEventListener('click', onDocClick, true)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      document.removeEventListener('click', onDocClick, true)
      marked?.removeAttribute('data-tour-active')
      document.body.classList.remove('tour-active')
    }
  }, [active, step, pathname, stepIndex, goToStep])

  if (!active || !step || step.path.split('?')[0] !== pathname || !cardPos) return null

  const isLast = stepIndex === steps.length - 1

  return (
    <>
      {rect && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            top: rect.top - HOLE,
            left: rect.left - HOLE,
            width: rect.width + HOLE * 2,
            height: rect.height + HOLE * 2,
            borderRadius: 12,
            boxShadow: '0 0 0 9999px rgba(20, 20, 18, 0.55)',
            pointerEvents: 'none',
            zIndex: 100000,
            transition: 'all 0.15s ease',
          }}
        />
      )}
      {!rect && (
        <div aria-hidden style={{ position: 'fixed', inset: 0, background: 'rgba(20, 20, 18, 0.55)', pointerEvents: 'none', zIndex: 100000 }} />
      )}
      <div
        ref={cardRef}
        style={{ position: 'fixed', left: cardPos.left, top: cardPos.top, width: CARD_W, zIndex: 100001 }}
        className="rounded-2xl bg-cream border border-ink/10 shadow-lg p-5"
      >
        <button aria-label="Close tour" onClick={finish} className="absolute top-3 right-3 text-sage hover:text-ink leading-none">
          <XIcon size={14} />
        </button>
        <div className="font-heading font-bold text-ink text-base pr-6">
          {step.title} <span className="text-sage font-normal text-sm">({stepIndex + 1}/{steps.length})</span>
        </div>
        <p className="text-sm text-sage mt-2 leading-relaxed">{step.description}</p>
        <div className="flex items-center justify-end gap-2 mt-4">
          {stepIndex > 0 && (
            <button onClick={() => goToStep(stepIndex - 1)} className="rounded-full px-3 py-1.5 text-sm text-sage hover:text-ink hover:bg-sand transition-colors">
              Previous
            </button>
          )}
          <button onClick={() => goToStep(stepIndex + 1)} className="rounded-full bg-accent text-white shadow-md px-4 py-1.5 text-sm font-medium hover:brightness-110 transition">
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>
  )
}
