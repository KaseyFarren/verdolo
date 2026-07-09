'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TOUR_STEPS } from '@/lib/tour'

function storageKey(orgId: string) {
  return `verdolo-tour-step-${orgId}`
}

// Mounted once in AppShell, owner-only - the tour is about getting the agency's initial setup
// done, not individual product familiarity, so a teammate invited after that's already happened
// never sees it. Each step lives on a specific page; progress is kept in localStorage so it
// survives the full page load between steps (see goToStep below for why that's a hard nav).
export default function TourProvider({ orgId, role }: { orgId: string; role?: 'owner' | 'admin' | 'member' }) {
  const pathname = usePathname()
  const [active, setActive] = useState(false)
  const checkedRef = useRef(false)

  useEffect(() => {
    if (role !== 'owner' || checkedRef.current) return
    checkedRef.current = true
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
    if (!active) return
    let cancelled = false
    let completed = false
    let unmounting = false
    let driverObj: { destroy: () => void } | null = null

    async function complete() {
      if (completed) return
      completed = true
      await fetch('/api/onboarding/complete-tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
    }

    function goToStep(index: number) {
      localStorage.setItem(storageKey(orgId), String(index))
      // Hard navigation, not router.push - every step lives on a page whose page.tsx wraps
      // AppShell itself (there's no shared authenticated layout), so a client-side transition
      // would leave this component's old instance alive in Next's router cache instead of
      // tearing it down, and its stale closure (still watching the old page's DOM) can then
      // misfire against the new page.
      window.location.assign(TOUR_STEPS[index].path)
    }

    async function start() {
      const stored = Number(localStorage.getItem(storageKey(orgId)) ?? '0')
      const index = Number.isInteger(stored) && stored >= 0 && stored < TOUR_STEPS.length ? stored : 0
      const step = TOUR_STEPS[index]
      if (step.path !== pathname) return

      if (index === 0 && window.innerWidth < 768) {
        document.getElementById('mobile-nav-toggle')?.click()
      }

      // The target element may not exist yet right after navigation (page fade-in, data fetch).
      for (let attempt = 0; attempt < 30 && !cancelled; attempt++) {
        if (document.querySelector(step.selector)) break
        await new Promise((r) => setTimeout(r, 100))
      }
      if (cancelled || !document.querySelector(step.selector)) return

      const { driver } = await import('driver.js')
      await import('driver.js/dist/driver.css')
      if (cancelled) return

      const isLast = index === TOUR_STEPS.length - 1
      const instance = driver({
        allowClose: true,
        onCloseClick: () => {
          complete()
          instance.destroy()
        },
        onDestroyed: () => {
          if (unmounting) return
          complete()
        },
        steps: [
          {
            element: step.selector,
            popover: {
              title: `${step.title} (${index + 1}/${TOUR_STEPS.length})`,
              description: step.description,
              side: 'right',
              align: 'start',
              nextBtnText: isLast ? 'Done' : 'Next',
              onNextClick: () => {
                if (isLast) {
                  complete()
                  instance.destroy()
                } else {
                  goToStep(index + 1)
                }
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
  }, [active, pathname, orgId])

  return null
}
