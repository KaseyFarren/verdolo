'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TOUR_STEPS } from '@/lib/tour'

// Mounted once in AppShell, owner-only - the tour is about getting the agency's initial setup
// done, not individual product familiarity, so a teammate invited after that's already happened
// never sees it. Anchored to sidebar nav items (present on every route), so it never needs to
// navigate between pages mid-tour.
export default function TourProvider({ orgId, role }: { orgId: string; role?: 'owner' | 'admin' | 'member' }) {
  const started = useRef(false)

  useEffect(() => {
    if (role !== 'owner' || started.current) return

    let cancelled = false

    async function maybeStart() {
      const supabase = createClient()
      const { data: org } = await supabase.from('orgs').select('onboarding_tour_completed_at').eq('id', orgId).maybeSingle()
      if (cancelled || org?.onboarding_tour_completed_at) return
      started.current = true

      // On mobile the sidebar is off-canvas until opened - the tour's first target lives there.
      if (window.innerWidth < 768) {
        document.getElementById('mobile-nav-toggle')?.click()
      }

      const { driver } = await import('driver.js')
      await import('driver.js/dist/driver.css')

      let completed = false
      async function complete() {
        if (completed) return
        completed = true
        await fetch('/api/onboarding/complete-tour', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId }),
        })
      }

      const driverObj = driver({
        showProgress: true,
        allowClose: true,
        onCloseClick: () => {
          complete()
          driverObj.destroy()
        },
        onDestroyed: () => {
          complete()
        },
        steps: TOUR_STEPS.map((step) => ({
          element: step.selector,
          popover: { title: step.title, description: step.description, side: 'right', align: 'start' },
        })),
      })

      // Give the (possibly just-opened) mobile nav a frame to render before measuring positions.
      requestAnimationFrame(() => driverObj.drive())
    }

    maybeStart()
    return () => {
      cancelled = true
    }
  }, [orgId, role])

  return null
}
