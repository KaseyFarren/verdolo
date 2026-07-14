import { test, expect } from '@playwright/test'
import { qaName } from './helpers/qa-data'

test.describe('Revenue (owner-only) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('add a charge then delete it', async ({ page }) => {
    await page.goto('/revenue')
    const firstClientRow = page.locator('button.group').first()
    await firstClientRow.click()

    // only the currently-expanded client's add-charge panel exists in the DOM at a time
    const panel = page.locator('div.pl-3.border-l-2')
    await expect(panel).toBeVisible({ timeout: 5_000 })

    const desc = qaName('charge')
    await panel.getByPlaceholder('What for?').fill(desc)
    await panel.locator('input').nth(1).fill('42')
    await panel.getByRole('button', { name: 'Add', exact: true }).click()

    const chargeRow = panel.locator('div').filter({ hasText: desc }).last()
    await expect(chargeRow).toBeVisible({ timeout: 10_000 })

    await chargeRow.getByText('✕', { exact: true }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click() // confirm dialog
    await expect(panel.locator('div').filter({ hasText: desc })).toHaveCount(0, { timeout: 5_000 })
  })
})

test.describe('Revenue role boundary @admin', () => {
  test.use({ storageState: 'playwright/.auth/admin.json' })

  test('admin is redirected away from /revenue (owner-only)', async ({ page }) => {
    await page.goto('/revenue')
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
