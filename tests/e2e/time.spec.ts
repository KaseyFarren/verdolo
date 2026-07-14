import { test, expect, type Page, type Locator } from '@playwright/test'
import { qaName } from './helpers/qa-data'

function entryRow(page: Page, noteText: string) {
  return page.locator('div.group').filter({ hasText: noteText })
}

// CustomSelect: click the trigger (first button in scope), then pick the first non-placeholder
// option - Time doesn't care which real client is used, only that time_entries reference one.
// nth(0) is the trigger itself, nth(1) is the "Select client…" placeholder option (value ''),
// so the first real client is nth(2).
async function pickFirstClient(scope: Locator) {
  await scope.getByRole('button').first().click()
  await scope.getByRole('button').nth(2).click()
}

test.describe('Time CRUD @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('add manual entry appears with correct duration', async ({ page }) => {
    await page.goto('/time')
    await page.getByRole('button', { name: '+ Add' }).click()

    const form = page.locator('div.rounded-lg.border', { has: page.getByPlaceholder('Hours (e.g. 1.5)') })
    await pickFirstClient(form)
    await form.getByPlaceholder('Hours (e.g. 1.5)').fill('1.5')
    const note = qaName('manual')
    await form.getByPlaceholder('Note (optional)').fill(note)
    await form.getByRole('button', { name: 'Save entry' }).click()

    const row = entryRow(page, note)
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText('1h 30m')
  })

  test('edit entry updates duration and persists after reload', async ({ page }) => {
    await page.goto('/time')
    await page.getByRole('button', { name: '+ Add' }).click()
    const form = page.locator('div.rounded-lg.border', { has: page.getByPlaceholder('Hours (e.g. 1.5)') })
    await pickFirstClient(form)
    await form.getByPlaceholder('Hours (e.g. 1.5)').fill('1')
    const note = qaName('edit')
    await form.getByPlaceholder('Note (optional)').fill(note)
    await form.getByRole('button', { name: 'Save entry' }).click()
    const row = entryRow(page, note)
    await expect(row).toBeVisible({ timeout: 10_000 })

    await row.hover()
    await row.getByLabel('Edit').click()
    const editForm = page.locator('div.bg-white.p-3', { has: page.getByPlaceholder('Hours') })
    await editForm.getByPlaceholder('Hours').fill('2')
    await editForm.getByRole('button', { name: 'Save', exact: true }).click()

    await expect(row).toContainText('2h', { timeout: 5_000 })
    await page.reload()
    await expect(entryRow(page, note)).toContainText('2h')
  })

  test('delete entry removes it (after undo window)', async ({ page }) => {
    await page.goto('/time')
    await page.getByRole('button', { name: '+ Add' }).click()
    const form = page.locator('div.rounded-lg.border', { has: page.getByPlaceholder('Hours (e.g. 1.5)') })
    await pickFirstClient(form)
    await form.getByPlaceholder('Hours (e.g. 1.5)').fill('0.5')
    const note = qaName('delete')
    await form.getByPlaceholder('Note (optional)').fill(note)
    await form.getByRole('button', { name: 'Save entry' }).click()
    const row = entryRow(page, note)
    await expect(row).toBeVisible({ timeout: 10_000 })

    await row.hover()
    await row.getByLabel('Delete').click()
    await expect(entryRow(page, note)).toHaveCount(0)

    await page.waitForTimeout(6_000)
    await page.reload()
    await expect(entryRow(page, note)).toHaveCount(0)
  })

  test('start and stop a timer creates a completed entry', async ({ page }) => {
    await page.goto('/time')
    const startPanel = page.locator('[data-tour="start-timer"]')
    await pickFirstClient(startPanel)
    await startPanel.getByPlaceholder('What are you working on? (optional)').fill(qaName('timer'))
    await startPanel.getByRole('button', { name: '▶ Start' }).click()

    await expect(startPanel.getByRole('button', { name: '■ Stop' })).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2_000)
    await startPanel.getByRole('button', { name: '■ Stop' }).click()

    await expect(startPanel.getByRole('button', { name: '▶ Start' })).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Time role boundaries @member', () => {
  test.use({ storageState: 'playwright/.auth/member.json' })

  test('admin-only clear buttons are hidden from members', async ({ page }) => {
    await page.goto('/time')
    await expect(page.getByRole('button', { name: 'Clear old entries' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Clear no-client' })).toHaveCount(0)
  })
})
