import { test, expect } from '@playwright/test'
import { qaName } from './helpers/qa-data'

test.describe('Dashboard @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('add task, then complete and uncomplete it', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: '+ Add' }).click()

    const title = qaName('dash-task')
    await page.getByPlaceholder('What needs doing?').fill(title)
    await page.getByRole('button', { name: 'Add task' }).click()

    const row = page.locator('div.group').filter({ hasText: title })
    await expect(row).toBeVisible({ timeout: 10_000 })

    const checkbox = row.locator('button').first()
    await checkbox.click()
    await expect(row.locator('div.line-through')).toBeVisible({ timeout: 5_000 })

    await checkbox.click()
    await expect(row.locator('div.line-through')).toHaveCount(0)
  })

  test('quick notes autosave and persist after reload', async ({ page }) => {
    await page.goto('/dashboard')
    const textarea = page.getByPlaceholder('Jot something down…')
    const original = await textarea.inputValue()

    const note = qaName('quicknote')
    await textarea.fill(note)
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })

    await page.reload()
    await expect(page.getByPlaceholder('Jot something down…')).toHaveValue(note)

    // restore - this is the real owner's personal scratch note, not throwaway QA data
    await page.getByPlaceholder('Jot something down…').fill(original)
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })
  })
})
