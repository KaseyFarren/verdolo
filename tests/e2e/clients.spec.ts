import { test, expect, type Page } from '@playwright/test'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { qaName } from './helpers/qa-data'

const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

function clientRow(page: Page, name: string) {
  return page.locator('div.cursor-pointer').filter({ hasText: name })
}

async function createClient(page: Page, name: string) {
  await page.goto('/clients')
  await page.getByRole('button', { name: '+ New client' }).click()
  const nameField = page.getByText('Name *', { exact: true }).locator('xpath=following-sibling::input[1]')
  await nameField.fill(name)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(clientRow(page, name)).toBeVisible({ timeout: 10_000 })
}

test.describe('Clients CRUD (admin+owner) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('create client appears in list and opens detail', async ({ page }) => {
    const name = qaName('client')
    await createClient(page, name)
    await clientRow(page, name).click()
    // clicking the row opens the detail panel, replacing the list - "Edit"/"Delete client"
    // controls only render there, so their presence confirms detail view actually opened
    await expect(page.getByTitle('Delete client')).toBeVisible()
  })

  test('edit client name persists after reload', async ({ page }) => {
    const name = qaName('editme')
    await createClient(page, name)
    await clientRow(page, name).click()

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const nameField = page.getByText('Name *', { exact: true }).locator('xpath=following-sibling::input[1]')
    const renamed = `${name}-renamed`
    await nameField.fill(renamed)
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await page.reload()
    await expect(clientRow(page, renamed)).toBeVisible({ timeout: 10_000 })
  })

  test('pause then activate toggles stage badge', async ({ page }) => {
    const name = qaName('pause')
    await createClient(page, name)
    await clientRow(page, name).click()

    // Pause/Activate render an SVG icon component, not a literal "⏸"/"▶" character - the
    // accessible name is just the word
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Activate', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Activate', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  })

  test('add note then delete note', async ({ page }) => {
    const name = qaName('notes')
    await createClient(page, name)
    await clientRow(page, name).click()

    const noteText = qaName('note-text')
    await page.getByPlaceholder('Add a note…').fill(noteText)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText(noteText)).toBeVisible({ timeout: 5_000 })

    // regression check for the client_notes RLS delete-policy bug fixed alongside this suite
    // (migration 0054) - deleting a note used to always fail with a rollback + error toast.
    // The delete trigger is an icon-only button with no text/aria-label, so target it by
    // position (the only button inside the note's own container) rather than by icon text.
    await page.getByText(noteText).locator('xpath=..').locator('button').click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click() // confirm dialog
    await expect(page.getByText(noteText)).toHaveCount(0, { timeout: 5_000 })
    await expect(page.getByText('Could not delete that note')).toHaveCount(0)

    await page.reload()
    await clientRow(page, name).click()
    await expect(page.getByText(noteText)).toHaveCount(0)
  })

  test('delete client removes it from list', async ({ page }) => {
    const name = qaName('delete')
    await createClient(page, name)
    await clientRow(page, name).click()

    await page.getByTitle('Delete client').click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click() // confirm dialog

    await expect(clientRow(page, name)).toHaveCount(0, { timeout: 10_000 })
    await page.reload()
    await expect(clientRow(page, name)).toHaveCount(0)
  })

  test('deleting a client actually deletes its tasks, not just orphans them', async ({ page }) => {
    // regression test for a bug found 2026-07-14: deleteClient() deleted the client first, which
    // (via tasks.client_id's "on delete set null" FK) nulled client_id on all its tasks before
    // the app's own follow-up `tasks.delete().eq('client_id', id)` could match them - so every
    // client deletion silently left its tasks behind as orphaned "no client" tasks instead of
    // removing them, despite the confirm dialog promising "This will also remove their tasks."
    const name = qaName('delete-with-task')
    await createClient(page, name)

    const { data: client } = await admin.from('clients').select('id').eq('name', name).single()
    const taskTitle = qaName('orphan-check')
    const { data: org } = await admin.from('clients').select('org_id').eq('id', client!.id).single()
    await admin.from('tasks').insert({ org_id: org!.org_id, client_id: client!.id, title: taskTitle, due_date: new Date().toISOString().slice(0, 10), done: false })

    await clientRow(page, name).click()
    await page.getByTitle('Delete client').click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click() // confirm dialog
    await expect(clientRow(page, name)).toHaveCount(0, { timeout: 10_000 })

    // the row disappears optimistically before the actual delete round-trip resolves - poll
    // rather than check once immediately, so this doesn't race the real async delete
    await expect(async () => {
      const { data: survivingTasks } = await admin.from('tasks').select('id').eq('title', taskTitle)
      expect(survivingTasks ?? []).toEqual([])
    }).toPass({ timeout: 5_000 })
  })
})

test.describe('Clients role boundary (member is read-only) @member', () => {
  test.use({ storageState: 'playwright/.auth/member.json' })

  test('member sees no create/edit/delete controls', async ({ page }) => {
    await page.goto('/clients')
    await expect(page.getByRole('button', { name: '+ New client' })).toHaveCount(0)

    const firstRow = page.locator('div.cursor-pointer').first()
    await firstRow.click()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0)
    await expect(page.getByTitle('Delete client')).toHaveCount(0)

    // quick-note textarea is shown but disabled for members, not hidden
    const quickNote = page.getByPlaceholder('Jot anything down…')
    await expect(quickNote).toBeVisible()
    await expect(quickNote).toBeDisabled()
  })

  test('member can still add a note (matches RLS: notes are org-member-writable)', async ({ page }) => {
    await page.goto('/clients')
    const firstRow = page.locator('div.cursor-pointer').first()
    await firstRow.click()

    const noteText = qaName('member-note')
    await page.getByPlaceholder('Add a note…').fill(noteText)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText(noteText)).toBeVisible({ timeout: 5_000 })
  })
})
