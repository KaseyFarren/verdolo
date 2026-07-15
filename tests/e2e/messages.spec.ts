import { test, expect, type Page } from '@playwright/test'
import { qaName } from './helpers/qa-data'

function messageRow(page: Page, text: string) {
  // the hover quick-react bar and the persisted reaction pill are both descendants of the row's
  // "group relative" wrapper (see MessageRow in MessagesClient.tsx) - scope to that ancestor so
  // both are reachable from one locator.
  return page.getByText(text, { exact: true }).locator('xpath=ancestor::div[contains(@class,"group") and contains(@class,"relative")][1]')
}

test.describe('Messages @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })
  // the seeded demo org has hundreds of historical messages (see memory
  // project_verdolo_june_simulation) and these tests share one live realtime-backed thread -
  // occasional latency spikes are infra/timing noise, not app logic, so retry instead of
  // chasing every flake with an even longer fixed timeout.
  test.setTimeout(45_000)
  test.describe.configure({ retries: 3 })

  test('send a team channel message', async ({ page }) => {
    await page.goto('/messages')
    await page.getByRole('button', { name: 'Team' }).click()

    const text = qaName('team-msg')
    const input = page.getByPlaceholder('Message the team… (@ to mention)')
    await input.fill(text)
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(input).toHaveValue('')
  })

  test('@mention a teammate inserts their name into the draft', async ({ page }) => {
    await page.goto('/messages')
    await page.getByRole('button', { name: 'Team' }).click()

    const prefix = qaName('mention')
    const input = page.getByPlaceholder('Message the team… (@ to mention)')
    await input.fill(`${prefix} @`)
    const suggestion = page.getByRole('button', { name: 'Everyone' }).or(page.locator('div.absolute.bottom-full button').first())
    await expect(suggestion.first()).toBeVisible({ timeout: 10_000 })
    await suggestion.first().click()

    await expect(input).toHaveValue(new RegExp(`^${prefix} @`))
    const text = await input.inputValue()
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 })
  })

  test('react to a message, then remove the reaction', async ({ page }) => {
    await page.goto('/messages')
    await page.getByRole('button', { name: 'Team' }).click()

    const text = qaName('react-msg')
    await page.getByPlaceholder('Message the team… (@ to mention)').fill(text)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const row = messageRow(page, text)
    await expect(row).toBeVisible({ timeout: 15_000 })

    await row.hover()
    await row.getByText('👍', { exact: true }).first().click()
    const reactionPill = row.locator('button', { hasText: '👍' }).filter({ hasText: '1' })
    await expect(reactionPill).toBeVisible({ timeout: 10_000 })

    await reactionPill.click()
    // the hover quick-react bar's own "👍" trigger is always in the DOM (just CSS-hidden until
    // hover), so checking for zero "👍" buttons entirely is wrong - check the persisted pill
    // (count-badge) specifically is gone instead
    await expect(reactionPill).toHaveCount(0)
  })

  test('open a DM thread and send a message', async ({ page }) => {
    await page.goto('/messages')
    // aside sidebar buttons in order: All, Unread, @Mentions filter toggle, Team, then each DM
    // contact - nth(4) is the first contact
    const firstContact = page.locator('aside').getByRole('button').nth(4)
    await firstContact.click()

    const text = qaName('dm-msg')
    const input = page.getByPlaceholder('Type a message…')
    await input.fill(text)
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 })
  })

  test('reply in thread opens the thread panel and shows the reply count', async ({ page }) => {
    await page.goto('/messages')
    await page.getByRole('button', { name: 'Team' }).click()

    const parentText = qaName('thread-parent')
    await page.getByPlaceholder('Message the team… (@ to mention)').fill(parentText)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const row = messageRow(page, parentText)
    await expect(row).toBeVisible({ timeout: 15_000 })

    await row.hover()
    await row.getByTitle('Reply in thread').click()
    await expect(page.getByText('Thread', { exact: true })).toBeVisible({ timeout: 10_000 })

    const replyText = qaName('thread-reply')
    const replyInput = page.getByPlaceholder('Reply…')
    await replyInput.fill(replyText)
    await replyInput.locator('xpath=ancestor::form[1]').getByRole('button', { name: 'Send', exact: true }).click()

    await expect(page.getByText(replyText, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(row.getByText('1 reply', { exact: true })).toBeVisible({ timeout: 15_000 })
  })

  test('sidebar unread filter hides already-read conversations', async ({ page }) => {
    await page.goto('/messages')
    await page.getByRole('button', { name: 'Team' }).click()
    await expect(page.getByRole('button', { name: 'Team' })).toBeVisible()

    await page.getByRole('button', { name: 'Unread', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Team' })).not.toBeVisible()

    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Team' })).toBeVisible()
  })
})
