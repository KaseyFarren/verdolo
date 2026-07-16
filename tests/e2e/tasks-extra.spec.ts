import { test, expect } from '@playwright/test'
import { qaName } from './helpers/qa-data'

test.use({ storageState: 'playwright/.auth/owner.json' })

function taskRow(page: import('@playwright/test').Page, title: string) {
  return page.locator('.group').filter({ has: page.getByTitle('Open task details', { exact: true }).filter({ hasText: title }) })
}

test.describe('Tasks Calendar view @owner', () => {
  test('calendar shows month grid, month nav works, and a task can be added on the selected day', async ({ page }) => {
    await page.goto('/tasks?view=calendar')
    await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible()

    const monthLabel = page.locator('div.text-sm.font-medium').first()
    const before = await monthLabel.textContent()
    await page.getByText('›', { exact: true }).click()
    await expect(monthLabel).not.toHaveText(before ?? '', { timeout: 5_000 })
    await page.getByText('‹', { exact: true }).click()
    await expect(monthLabel).toHaveText(before ?? '', { timeout: 5_000 })

    // today should be selected by default (see TasksClient effect that seeds selectedDate)
    const title = qaName('cal')
    await page.getByRole('button', { name: '+ New task' }).click()
    await page.getByPlaceholder('What needs doing?').fill(title)
    await page.getByRole('button', { name: 'Add task' }).click()
    await expect(taskRow(page, title)).toBeVisible({ timeout: 10_000 })

    // clean up - deletion only removes the row optimistically, the real delete fires 5s later
    // (see TasksClient's undo window), so stay on the page past that mark or the task never
    // actually leaves the database once this test's page context closes
    await taskRow(page, title).hover()
    await taskRow(page, title).getByLabel('Delete').click()
    await page.waitForTimeout(5_500)
  })
})

test.describe('Tasks Defaults view @owner', () => {
  test('a default task template can be added, paused, edited, and deleted', async ({ page }) => {
    await page.goto('/tasks')
    await page.getByRole('button', { name: 'Defaults', exact: true }).click()
    await page.getByRole('button', { name: '+ New task' }).click()

    const title = qaName('default')
    // scope every form lookup to an ancestor of a field unique to that specific form, rather
    // than "the first .rounded-lg.border on the page" - other globally-mounted overlays (e.g.
    // QuickCapture, ConfirmDialog) share that same class combo
    const titleInput = page.getByPlaceholder('e.g. Daily check-in')
    const addForm = titleInput.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
    await titleInput.fill(title)
    await addForm.getByRole('button', { name: 'Save' }).click()

    // addDefault() regenerates today/tomorrow instances across every client before closing the
    // form (the new row itself appears sooner, mid-way through that) - wait for the form to
    // actually close so it can't be confused with the edit form opened a few lines down
    await expect(addForm).toHaveCount(0, { timeout: 15_000 })

    // scope to the Defaults panel specifically ("border-b" is a common utility class used
    // elsewhere on the page too) - this new template is appended last, so its wrapper is
    // reliably the last `div.border-b` within that scope. Position-based, not hasText-based:
    // once editing starts, the title moves into an <input value> which contributes nothing to
    // textContent, so a hasText filter would stop matching this same wrapper mid-test.
    const defaultsPanel = page.locator('div').filter({ hasText: 'Applied automatically to every client' }).last()
    const item = defaultsPanel.locator('div.border-b').last()
    await expect(item).toContainText(title, { timeout: 10_000 })

    await item.getByRole('button', { name: 'Pause' }).click()
    await expect(item.getByText('Paused')).toBeVisible({ timeout: 5_000 })
    await item.getByRole('button', { name: 'Resume' }).click()
    await expect(item.getByText('Paused')).toHaveCount(0)

    await item.getByRole('button', { name: 'Edit' }).click()
    const editedTitle = `${title}-edited`
    await item.locator('input').first().fill(editedTitle)
    await item.getByRole('button', { name: 'Save' }).click()

    await expect(item).toContainText(editedTitle, { timeout: 5_000 })
    await item.getByRole('button', { name: 'Delete' }).click()
    await expect(defaultsPanel.locator('div.border-b').last()).not.toContainText(editedTitle)
  })
})

test.describe('Tasks list filter and sort @owner', () => {
  test('filter and sort selects change without erroring', async ({ page }) => {
    await page.goto('/tasks')

    // the CustomSelect trigger buttons' accessible name includes a trailing "▾" glyph and
    // changes with the selected value, so locate by stable DOM position rather than current
    // text. On the list view the toolbar renders DatePicker ("Pick a date…▾"), then filter,
    // then sort - index 1 is the filter select.
    const toolbar = page.locator('[data-tour="add-task-region"]')
    const filterSelect = toolbar.getByRole('button', { name: /▾$/ }).nth(1)
    await filterSelect.click()
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(filterSelect).toContainText('Today')
    await filterSelect.click()
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(filterSelect).toContainText('All')

    // matches on the "Sort:" prefix (stable) rather than the current value (changes on select)
    const sortSelect = page.getByRole('button', { name: /^Sort:/ })
    await sortSelect.click()
    await page.getByRole('button', { name: 'Sort: Priority' }).click()
    await expect(sortSelect).toContainText('Priority')

    await sortSelect.click()
    await page.getByRole('button', { name: 'Sort: Due date' }).click()
    await expect(sortSelect).toContainText('Due date')
  })
})

test.describe('Tasks import from doc @owner', () => {
  test('pasted notes generate reviewable draft tasks that can be added then removed', async ({ page }) => {
    await page.goto('/tasks')
    await page.getByRole('button', { name: 'Import from doc' }).click()
    await expect(page.getByText('Import tasks from doc')).toBeVisible()

    const marker = qaName('import')
    await page
      .getByPlaceholder('Paste a meeting transcript or notes here…')
      .fill(`Meeting notes: follow up with the client about the ${marker} proposal by Friday. Also send the updated invoice.`)
    await page.getByRole('button', { name: 'Generate tasks' }).click()

    await expect(page.getByText(/Found \d+ tasks? - review before adding\./)).toBeVisible({ timeout: 30_000 })

    const addButton = page.getByRole('button', { name: /^Add \d+ tasks?$/ })
    await expect(addButton).toBeEnabled()
    await addButton.click()
    await expect(page.getByText('Import tasks from doc')).toHaveCount(0, { timeout: 10_000 })

    // clean up whatever titles got imported that reference our marker text (AI-generated
    // titles are non-deterministic, so match on the marker rather than an exact title)
    const imported = page.locator('.group').filter({ hasText: new RegExp(marker, 'i') })
    const count = await imported.count()
    for (let i = 0; i < count; i++) {
      const row = imported.first()
      await row.hover()
      await row.getByLabel('Delete').click()
      await page.waitForTimeout(300)
    }
    // deletion only removes the row optimistically - the real delete fires 5s later (see
    // TasksClient's undo window), so the test must stay on the page past that mark or the
    // timer gets killed with the page context and the task never actually leaves the database
    await page.waitForTimeout(5_500)
  })
})
