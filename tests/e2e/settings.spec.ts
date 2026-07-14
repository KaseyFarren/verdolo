import { test, expect } from '@playwright/test'
import { qaName } from './helpers/qa-data'

const ACCENT_PRESETS = ['#dd6b2c', '#1f3320', '#e98a4f', '#5d6b5c', '#c9973c', '#8a6a3c']

test.describe('Settings (owner) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('display name saves and persists after reload', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Profile', exact: true }).click()

    const input = page.locator('[data-tour="display-name"]')
    const original = await input.inputValue()
    const name = qaName('name')

    await input.fill(name)
    await input.blur()
    await expect(page.getByText('Saved ✓')).toBeVisible({ timeout: 5_000 })

    await page.reload()
    await page.getByRole('button', { name: 'Profile', exact: true }).click()
    await expect(page.locator('[data-tour="display-name"]')).toHaveValue(name)

    // restore - this is the real signed-in owner's profile, not throwaway QA data
    await page.locator('[data-tour="display-name"]').fill(original)
    await page.locator('[data-tour="display-name"]').blur()
    await expect(page.getByText('Saved ✓')).toBeVisible({ timeout: 5_000 })
  })

  test('accent color swatch changes then restores', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()

    const swatches = ACCENT_PRESETS.map((c) => page.getByLabel(c, { exact: true }))
    await expect(swatches[0]).toBeVisible({ timeout: 5_000 })

    // find which swatch is currently selected (white border) so we can restore it after
    let originalIndex = 0
    for (let i = 0; i < swatches.length; i++) {
      const style = await swatches[i].getAttribute('style')
      if (style?.includes('border-color: rgb(255, 255, 255)') || style?.includes('#fff')) originalIndex = i
    }
    const targetIndex = (originalIndex + 1) % swatches.length

    await swatches[targetIndex].click()
    await expect(page.getByText('Accent color updated')).toBeVisible({ timeout: 5_000 })

    await swatches[originalIndex].click()
    await expect(page.getByText('Accent color updated')).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Settings role boundary @member', () => {
  test.use({ storageState: 'playwright/.auth/member.json' })

  test('appearance nav item is hidden entirely for members', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toHaveCount(0)
  })

  test('general toggles are visible but inert for members', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'General', exact: true }).click()

    // Row renders title/subtitle nested two levels inside the outer row div - target that
    // outer div (the one with the Row component's own distinguishing layout class) directly
    const row = page.getByText('Skip weekends').locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
    const toggle = row.locator('div.rounded-full.relative').first()
    const before = await toggle.getAttribute('class')
    await toggle.click()
    await page.waitForTimeout(500)
    const after = await toggle.getAttribute('class')
    expect(after).toBe(before)
  })
})
