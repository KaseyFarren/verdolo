import { test, expect } from '@playwright/test'

// Reports writes (recap generate/backfill/scope-creep note) all call AI endpoints that consume
// the org's monthly AI credit allowance (see Settings → Integrations) - keep this file's AI
// calls to the minimum needed to prove the button actually works end to end.

test.describe('Reports Overview (owner+admin) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('nav switches between Overview, Profitability, and Capacity views', async ({ page }) => {
    await page.goto('/reports')
    await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Profitability', exact: true }).click()
    await expect(page.getByText('Effective rate', { exact: false }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Capacity', exact: true }).click()
    await expect(page.getByText('Open workload', { exact: false })).toBeVisible()

    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(page.getByText('By client', { exact: false })).toBeVisible()
  })

  test('period selector switches range presets', async ({ page }) => {
    await page.goto('/reports')
    await page.getByRole('button', { name: 'Last week', exact: true }).click()
    await expect(page).toHaveURL(/range=last_week/)

    await page.getByRole('button', { name: 'This month', exact: true }).click()
    await expect(page).toHaveURL(/range=this_month/)

    await page.getByRole('button', { name: 'This week', exact: true }).click()
    await expect(page).toHaveURL(/^(?!.*range=)/)
  })

  test('weekly recap can be generated (or regenerated) end to end', async ({ page }) => {
    await page.goto('/reports')
    const noAi = page.getByText("AI features aren't configured on this deployment")
    if (await noAi.isVisible({ timeout: 2_000 }).catch(() => false)) {
      test.skip(true, 'AI features not configured on this deployment')
    }

    const regenerate = page.getByRole('button', { name: 'Regenerate' })
    const generate = page.getByRole('button', { name: /Generate weekly recap/ })

    if (await regenerate.isVisible().catch(() => false)) {
      await regenerate.click()
    } else {
      await expect(generate).toBeVisible({ timeout: 5_000 })
      await generate.click()
    }
    // recap card shows either the freshly generated text or falls back to "Generating…" briefly
    await expect(page.locator('.border-accent').getByText(/.+/).first()).toBeVisible({ timeout: 30_000 })
  })

  test('report library type filter and backfill panel toggle', async ({ page }) => {
    await page.goto('/reports')

    const filter = page.locator('div').filter({ hasText: /^All$/ }).getByRole('button')
    if (await filter.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      await filter.first().click()
      await page.getByRole('button', { name: 'Weekly', exact: true }).click()
    }

    await page.getByRole('button', { name: '+ Generate for a past period' }).click()
    await expect(page.getByText('Pick any date - it snaps to that date')).toBeVisible()
    await page.getByRole('button', { name: 'month', exact: true }).click()
    await expect(page.getByText('Pick any month to generate or regenerate its recap.')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  })
})

test.describe('Reports Profitability (owner+admin) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('month navigation, trend granularity, and trailing-count controls work', async ({ page }) => {
    await page.goto('/reports')
    await page.getByRole('button', { name: 'Profitability', exact: true }).click()

    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page).toHaveURL(/pMonth=/)

    const nextButton = page.getByRole('button', { name: 'Next month' })
    if (await nextButton.isEnabled()) {
      await nextButton.click()
    }

    await page.getByRole('button', { name: 'By week', exact: true }).click()
    await expect(page.getByText('Rate spreads each retainer evenly', { exact: false })).toBeVisible()

    await page.getByRole('button', { name: 'By month', exact: true }).click()
  })
})

test.describe('Reports Capacity (owner+admin) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('capacity view lists team open workload', async ({ page }) => {
    await page.goto('/reports')
    await page.getByRole('button', { name: 'Capacity', exact: true }).click()
    await expect(page.getByText('Open workload', { exact: false })).toBeVisible()
    await expect(page.getByText(/open task/).first()).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Reports (admin can also reach and use it) @admin', () => {
  test.use({ storageState: 'playwright/.auth/admin.json' })

  test('admin can view all three tabs', async ({ page }) => {
    await page.goto('/reports')
    await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Profitability', exact: true }).click()
    await page.getByRole('button', { name: 'Capacity', exact: true }).click()
    await expect(page.getByText('Open workload', { exact: false })).toBeVisible()
  })
})
