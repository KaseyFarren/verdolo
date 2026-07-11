'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { stepsForRole, tourReplayKey, tourStepKey, type Role, type TourStep } from '@/lib/tour'

// Mounted once in AppShell for every role. Two ways it activates:
//   1. Owner first-run - if the org has never completed the tour, it starts automatically. This is
//      about getting the agency's initial setup done, so only the owner is auto-prompted.
//   2. Replay - any role can re-trigger it from Settings (startTourReplay sets the replay flag);
//      that path never persists completion and is filtered to a role-appropriate set of steps.
// Each step lives on a specific page; progress is kept in localStorage so it survives the full
// page load between steps (see goToStep for why that has to be a hard navigation).
export default function TourProvider({ orgId, role }: { orgId: string; role?: Role }) {
  const pathname = usePathname()
  const [active, setActive] = useState(false)
  // A replay runs the tour without persisting completion (and for non-owners is the only entry).
  const [isReplay, setIsReplay] = useState(false)
  const checkedRef = useRef(false)

  useEffect(() => {
    if (!role || checkedRef.current) return
    checkedRef.current = true

    // Replay is armed synchronously in localStorage before the navigation that lands us here, so
    // it takes precedence and needs no network round-trip.
    if (localStorage.getItem(tourReplayKey(orgId)) === '1') {
      setIsReplay(true)
      setActive(true)
      return
    }

    // Otherwise only the owner gets the automatic first-run tour.
    if (role !== 'owner') return
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data: org } = await supabase.from('orgs').select('onboarding_tour_completed_at').eq('id', orgId).maybeSingle()
      if (!cancelled && !org?.onboarding_tour_completed_at) setActive(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, role])

  useEffect(() => {
    if (!active || !role) return
    const steps: TourStep[] = stepsForRole(role)
    if (steps.length === 0) return

    let cancelled = false
    let finished = false
    let unmounting = false
    let driverObj: { destroy: () => void } | null = null

    async function finish() {
      if (finished) return
      finished = true
      localStorage.removeItem(tourStepKey(orgId))
      localStorage.removeItem(tourReplayKey(orgId))
      // Persist completion only for the owner's genuine first run - the API is owner-only, and a
      // replay (any role) shouldn't stamp or re-stamp the org's onboarding flag.
      if (!isReplay && role === 'owner') {
        await fetch('/api/onboarding/complete-tour', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId }),
        })
      }
    }

    function goToStep(index: number) {
      localStorage.setItem(tourStepKey(orgId), String(index))
      // Hard navigation, not router.push - every step lives on a page whose page.tsx wraps
      // AppShell itself (there's no shared authenticated layout), so a client-side transition
      // would leave this component's old instance alive in Next's router cache instead of tearing
      // it down, and its stale closure (still watching the old page's DOM) can then misfire.
      window.location.assign(steps[index].path)
    }

    async function start() {
      const stored = Number(localStorage.getItem(tourStepKey(orgId)) ?? '0')
      const index = Number.isInteger(stored) && stored >= 0 && stored < steps.length ? stored : 0
      const step = steps[index]
      // Steps may deep-link a settings tab (path has a ?view= query); match on the pathname only.
      if (step.path.split('?')[0] !== pathname) return

      if (index === 0 && window.innerWidth < 768) {
        document.getElementById('mobile-nav-toggle')?.click()
      }

      // The target element may not exist yet right after navigation (page fade-in, data fetch).
      for (let attempt = 0; attempt < 30 && !cancelled; attempt++) {
        if (document.querySelector(step.selector)) break
        await new Promise((r) => setTimeout(r, 100))
      }
      if (cancelled) return

      // A step's anchor can be legitimately absent (e.g. "complete a task" when there are no tasks
      // yet, or a role landing on an empty state). Rather than stall the whole tour, skip ahead -
      // the final step anchors on the always-present nav, so this can't loop forever.
      if (!document.querySelector(step.selector)) {
        if (index < steps.length - 1) goToStep(index + 1)
        else finish()
        return
      }

      const { driver } = await import('driver.js')
      await import('driver.js/dist/driver.css')
      if (cancelled) return

      const isLast = index === steps.length - 1
      const instance = driver({
        // Never dismiss on an outside/overlay click - several steps ask the user to interact with
        // the page (fill the add-client form, start a timer) right next to the popover, and driver
        // otherwise treats those clicks as "close". The popover's own X (onCloseClick) still exits.
        allowClose: false,
        // Lighter dim on steps the user fills in, so a form that opens below the highlight stays
        // clearly legible; heavier dim on read-only steps for stronger focus.
        overlayOpacity: step.interactive ? 0.45 : 0.7,
        onCloseClick: () => {
          finish()
          instance.destroy()
        },
        onDestroyed: () => {
          if (unmounting) return
          finish()
        },
        steps: [
          {
            element: step.selector,
            popover: {
              title: `${step.title} (${index + 1}/${steps.length})`,
              description: step.description,
              // Let driver auto-fit by default so the popover lands on whichever side has room and
              // doesn't cover the input; a step can force a side when auto-fit picks poorly.
              ...(step.side ? { side: step.side } : {}),
              ...(step.align ? { align: step.align } : {}),
              // First step has nowhere to go back to, so drop the Previous button there.
              showButtons: index === 0 ? ['next', 'close'] : ['previous', 'next', 'close'],
              nextBtnText: isLast ? 'Done' : 'Next',
              onNextClick: () => {
                if (isLast) {
                  finish()
                  instance.destroy()
                } else {
                  goToStep(index + 1)
                }
              },
              onPrevClick: () => {
                if (index > 0) goToStep(index - 1)
              },
            },
          },
        ],
      })
      driverObj = instance
      instance.drive()
    }

    start()
    return () => {
      cancelled = true
      unmounting = true
      driverObj?.destroy()
    }
  }, [active, isReplay, pathname, orgId, role])

  return null
}
