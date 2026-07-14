import { test, expect } from '@playwright/test'
import { qaName } from './helpers/qa-data'

function memberRow(page: import('@playwright/test').Page, matchText: string) {
  return page.locator('li').filter({ hasText: matchText })
}

test.describe('Team (admin+owner) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('invite a member, see them as invited, then remove them', async ({ page }) => {
    await page.goto('/team')
    const email = `${qaName('invite')}@example.test`.toLowerCase()
    await page.getByPlaceholder('teammate@email.com').fill(email)
    await page.getByRole('button', { name: 'Invite', exact: true }).click()

    await expect(page.getByText('Invite sent')).toBeVisible({ timeout: 10_000 })
    const row = memberRow(page, email)
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText('invited')

    await row.getByRole('button', { name: 'Remove', exact: true }).click()
    // confirm dialog's own button - distinct danger-styled class vs. the row's plain trigger
    await page.locator('button.\\!bg-red-600', { hasText: 'Remove' }).click()
    await expect(memberRow(page, email)).toHaveCount(0, { timeout: 5_000 })
  })

  test('owner-only role option: Owner is selectable when inviting', async ({ page }) => {
    await page.goto('/team')
    const section = page.locator('section[data-tour="invite-teammate"]')
    // section buttons in order: [role CustomSelect trigger, Invite submit] - first() is the role select
    await section.getByRole('button').first().click()
    await expect(page.getByRole('button', { name: 'Owner', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('edit a teammate\'s title persists after reload', async ({ page }) => {
    await page.goto('/team')
    // edit a non-owner row (the owner's own row is editable too, just avoid ambiguity). Row
    // order isn't guaranteed stable across reloads (ties in joined_at), so capture the member's
    // own name text now and re-find by that after reload rather than relying on position.
    const row = page.locator('li').filter({ hasNotText: '(you)' }).first()
    const memberName = (await row.locator('span.truncate').first().textContent())?.trim()
    if (!memberName) throw new Error('could not read member name from row')

    const title = qaName('title')
    const titleInput = row.getByPlaceholder('Add role/title…')
    await titleInput.fill(title)
    await titleInput.blur()
    await expect(page.getByText('Title updated')).toBeVisible({ timeout: 5_000 })

    await page.reload()
    // "Add role/title…" is a placeholder, not text content - hasText locator filters can't see
    // into an <input>'s value, so check the reloaded input's value directly instead
    const reloadedRow = page.locator('li').filter({ hasText: memberName })
    await expect(reloadedRow.getByPlaceholder('Add role/title…')).toHaveValue(title)
  })
})
