import { test, expect, type Page } from '@playwright/test'
import { qaName } from './helpers/qa-data'

function proposalCard(page: Page, title: string) {
  return page.locator('div.rounded-2xl').filter({ hasText: title })
}

test.describe('Proposals (admin+owner) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('create as a new prospect, then walk through status transitions, then delete', async ({ page }) => {
    await page.goto('/proposals')
    await page.getByRole('button', { name: '+ New proposal' }).click()
    await page.getByRole('button', { name: 'New prospect' }).click()

    const prospect = qaName('prospect')
    const title = qaName('proposal')
    await page.getByPlaceholder('Prospect / company name').fill(prospect)
    await page.getByPlaceholder('Proposal title').fill(title)
    await page.getByRole('button', { name: 'Create proposal' }).click()

    const card = proposalCard(page, title)
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('Draft')

    await card.getByRole('button', { name: 'Mark sent' }).click()
    await expect(card).toContainText('Sent')

    await card.getByRole('button', { name: 'Signed', exact: true }).click()
    await expect(card).toContainText('Signed')

    await page.reload()
    const reloadedCard = proposalCard(page, title)
    await expect(reloadedCard).toContainText('Signed')

    await reloadedCard.getByRole('button', { name: 'Delete', exact: true }).click()
    // the confirm dialog's own Delete button (distinct danger styling) - both it and the card's
    // trigger button match "Delete" exactly, so scope to the dialog's red variant class
    await page.locator('button.\\!bg-red-600', { hasText: 'Delete' }).click()
    await expect(proposalCard(page, title)).toHaveCount(0, { timeout: 5_000 })
    await page.reload()
    await expect(proposalCard(page, title)).toHaveCount(0)
  })

  test('sent proposal can be declined', async ({ page }) => {
    await page.goto('/proposals')
    await page.getByRole('button', { name: '+ New proposal' }).click()
    await page.getByRole('button', { name: 'New prospect' }).click()

    const prospect = qaName('prospect-decline')
    const title = qaName('proposal-decline')
    await page.getByPlaceholder('Prospect / company name').fill(prospect)
    await page.getByPlaceholder('Proposal title').fill(title)
    await page.getByRole('button', { name: 'Create proposal' }).click()

    const card = proposalCard(page, title)
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.getByRole('button', { name: 'Mark sent' }).click()
    await card.getByRole('button', { name: 'Declined', exact: true }).click()
    await expect(card).toContainText('Declined')
  })
})

test.describe('Proposals role boundary @member', () => {
  test.use({ storageState: 'playwright/.auth/member.json' })

  test('member sees no create/status/delete controls', async ({ page }) => {
    await page.goto('/proposals')
    await expect(page.getByRole('button', { name: '+ New proposal' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark sent' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
  })
})
