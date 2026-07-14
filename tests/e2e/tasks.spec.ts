import { test, expect } from '@playwright/test'
import { qaName } from './helpers/qa-data'

test.use({ storageState: 'playwright/.auth/owner.json' })

// Row locator: TaskRow renders the title inside a button[title="Open task details"], and the
// whole row shares the "group" class with the checkbox/actions (see TaskRow.tsx) - scope every
// per-row interaction through this so tests never touch the wrong task.
function taskRow(page: import('@playwright/test').Page, title: string) {
  return page.locator('.group').filter({ has: page.getByTitle('Open task details', { exact: true }).filter({ hasText: title }) })
}

async function addQuickTask(page: import('@playwright/test').Page, title: string) {
  await page.goto('/tasks')
  await page.getByRole('button', { name: '+ New task' }).click()
  await page.getByPlaceholder('What needs doing?').fill(title)
  await page.getByRole('button', { name: 'Add task' }).click()
  await expect(taskRow(page, title)).toBeVisible({ timeout: 10_000 })
}

test.describe('Tasks CRUD @owner', () => {
  test('add task appears in list', async ({ page }) => {
    const title = qaName('add')
    await addQuickTask(page, title)
  })

  test('complete then uncomplete task toggles struck-through state', async ({ page }) => {
    const title = qaName('complete')
    await addQuickTask(page, title)
    const row = taskRow(page, title)

    await row.locator('[data-tour="task-checkbox"]').click()
    await expect(row.getByTitle('Open task details')).toHaveClass(/line-through/)

    await row.locator('[data-tour="task-checkbox"]').click()
    await expect(row.getByTitle('Open task details')).not.toHaveClass(/line-through/)
  })

  test('snooze pushes due date to tomorrow', async ({ page }) => {
    const title = qaName('snooze')
    await addQuickTask(page, title)
    const row = taskRow(page, title)

    await row.hover()
    await row.getByLabel('Snooze - push to tomorrow').click()

    const tomorrow = new Date(Date.now() + 86_400_000)
    const expected = tomorrow.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    await expect(row).toContainText(expected)
  })

  test('delete removes the task (after undo window)', async ({ page }) => {
    const title = qaName('delete')
    await addQuickTask(page, title)
    const row = taskRow(page, title)

    await row.hover()
    await row.getByLabel('Delete').click()
    await expect(taskRow(page, title)).toHaveCount(0)

    // the real delete fires 5s after the optimistic removal (undo window) - reload past that
    // window and confirm it's actually gone server-side, not just hidden client-side
    await page.waitForTimeout(6_000)
    await page.reload()
    await expect(taskRow(page, title)).toHaveCount(0)
  })

  test('edit priority inline persists after reload', async ({ page }) => {
    const title = qaName('priority')
    await page.goto('/tasks')
    await page.getByRole('button', { name: '+ New task' }).click()
    // detailed mode exposes the priority selector
    await page.getByRole('button', { name: 'detailed' }).click()
    await page.getByPlaceholder('What needs doing?').fill(title)
    await page.getByRole('button', { name: 'Add task' }).click()
    const row = taskRow(page, title)
    await expect(row).toBeVisible()

    // priority select is a CustomSelect in the (desktop-only) priority column; open task detail
    // modal instead, which exposes the same field without viewport-width flakiness
    await row.getByTitle('Open task details').click()
    const priorityField = page.getByText('Priority', { exact: true }).locator('xpath=..')
    await priorityField.getByRole('button').click()
    await priorityField.getByRole('button', { name: 'High', exact: true }).click()
    await page.getByRole('button', { name: 'Save' }).click()

    await page.reload()
    await expect(taskRow(page, title)).toContainText('High')
  })

  test('add subtask nests under parent and updates open-count badge', async ({ page }) => {
    const parentTitle = qaName('parent')
    await addQuickTask(page, parentTitle)
    const parentRow = taskRow(page, parentTitle)
    // "+ Add subtask" is a sibling of the .group row, not a descendant - scope to their shared
    // outer wrapper instead (see TaskRow.tsx: row div + notes + subtask-add button all live
    // under one untagged outer <div>)
    const parentWrapper = parentRow.locator('xpath=..')

    await parentRow.hover()
    await parentWrapper.getByText('+ Add subtask').click()
    const subTitle = qaName('sub')
    await page.getByPlaceholder('What needs doing?').last().fill(subTitle)
    await page.getByRole('button', { name: 'Add subtask', exact: true }).click()

    await expect(taskRow(page, subTitle)).toBeVisible()
    await expect(parentRow).toContainText('0/1')

    await taskRow(page, subTitle).locator('[data-tour="task-checkbox"]').click()
    await expect(parentRow).toContainText('1/1')
  })

  test('log manual time on a task shows confirmation toast', async ({ page }) => {
    const title = qaName('time')
    await addQuickTask(page, title)
    const row = taskRow(page, title)

    await row.hover()
    await row.getByLabel('Log time manually').click()
    await page.getByPlaceholder(/hours|hrs|h/i).first().fill('1.5')
    await page.keyboard.press('Enter')

    await expect(page.getByText('1.5h logged')).toBeVisible({ timeout: 5_000 })
  })

  test('recurring task: create, appears as an instance, then delete removes template + instances', async ({ page }) => {
    await page.goto('/tasks')
    await page.getByRole('button', { name: 'Recurring', exact: true }).click()
    await page.getByRole('button', { name: '+ New task' }).click()

    const title = qaName('recurring')
    await page.getByPlaceholder('e.g. Check emails').fill(title)
    await page.getByRole('button', { name: 'Save' }).click()

    const templateRow = page.locator('div.flex.items-center.gap-3').filter({ hasText: title })
    await expect(templateRow).toBeVisible({ timeout: 10_000 })

    // a generated instance should show up back in the List view without a reload - regeneration
    // creates both a today and tomorrow instance, so expect at least one, not exactly one
    await page.getByRole('button', { name: 'List', exact: true }).click()
    await expect(taskRow(page, title).first()).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Recurring', exact: true }).click()
    await templateRow.getByRole('button', { name: 'Delete' }).click()
    await expect(templateRow).toHaveCount(0)

    // reload (not just checking optimistic client state) to confirm the instances were actually
    // hard-deleted server-side, not just spliced out of local state
    await page.reload()
    await page.getByRole('button', { name: 'List', exact: true }).click()
    await expect(taskRow(page, title)).toHaveCount(0, { timeout: 10_000 })
  })
})
