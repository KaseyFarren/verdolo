import { test, expect, type Page } from '@playwright/test'

// Nav pages every role can see, plus the role-gated ones with an `only` list of which
// roles should actually be able to load them (others must be redirected away).
const PAGES = [
  { path: '/dashboard', only: ['owner', 'admin', 'member'] },
  { path: '/tasks', only: ['owner', 'admin', 'member'] },
  { path: '/clients', only: ['owner', 'admin', 'member'] },
  { path: '/proposals', only: ['owner', 'admin', 'member'] },
  { path: '/time', only: ['owner', 'admin', 'member'] },
  { path: '/messages', only: ['owner', 'admin', 'member'] },
  { path: '/settings', only: ['owner', 'admin', 'member'] },
  { path: '/reports', only: ['owner', 'admin'] },
  { path: '/team', only: ['owner', 'admin'] },
  { path: '/revenue', only: ['owner'] },
] as const

function collectErrors(page: Page) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => pageErrors.push(err.message))
  page.on('response', (res) => {
    if (res.status() >= 500) failedRequests.push(`${res.status()} ${res.url()}`)
  })

  return { consoleErrors, pageErrors, failedRequests }
}

for (const role of ['owner', 'admin', 'member'] as const) {
  test.describe(`${role} role`, () => {
    for (const { path, only } of PAGES) {
      const allowed = (only as readonly string[]).includes(role)

      test(`${path} - ${allowed ? 'loads for' : 'blocks'} ${role} @${role}`, async ({ page }) => {
        const errors = collectErrors(page)

        await page.goto(path)

        if (allowed) {
          await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`))
          // page rendered its own heading, not a Next.js error overlay
          await expect(page.locator('body')).not.toContainText('Application error')
        } else {
          // server-side redirect away from the gated page (see requireOrgContext role checks)
          await expect(page).not.toHaveURL(new RegExp(`${path}(\\?|$)`))
        }

        expect(errors.failedRequests, `500s on ${path}`).toEqual([])
        expect(errors.pageErrors, `uncaught page errors on ${path}`).toEqual([])
      })
    }

    test(`nav only shows role-appropriate links @${role}`, async ({ page }) => {
      await page.goto('/dashboard')

      const expectedVisible = PAGES.filter((p) => (p.only as readonly string[]).includes(role))
      const expectedHidden = PAGES.filter((p) => !(p.only as readonly string[]).includes(role))

      for (const { path } of expectedVisible) {
        await expect(page.locator(`nav a[href="${path}"]`)).toBeVisible()
      }
      for (const { path } of expectedHidden) {
        await expect(page.locator(`nav a[href="${path}"]`)).toHaveCount(0)
      }
    })
  })
}
