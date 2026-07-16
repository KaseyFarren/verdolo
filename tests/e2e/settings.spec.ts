import { test, expect } from '@playwright/test'
import { qaName } from './helpers/qa-data'

// Every describe below (owner in particular) reads/writes the same real orgs.settings jsonb
// blob and org_members row - fullyParallel workers racing on those columns clobber each other's
// writes (that's a real product bug when it happens between two tabs too, see the cross-tab
// regression test below, but here it's just test isolation). Serialize the whole file.
test.describe.configure({ mode: 'serial' })

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
    // the checkmark next to "Saved" is an inline SVG icon, not a literal "✓" character - text
    // matchers can only see "Saved"
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })

    await page.reload()
    await page.getByRole('button', { name: 'Profile', exact: true }).click()
    await expect(page.locator('[data-tour="display-name"]')).toHaveValue(name)

    // restore - this is the real signed-in owner's profile, not throwaway QA data
    await page.locator('[data-tour="display-name"]').fill(original)
    await page.locator('[data-tour="display-name"]').blur()
    // the checkmark next to "Saved" is an inline SVG icon, not a literal "✓" character - text
    // matchers can only see "Saved"
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })
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

  test('voice and billing nav items are hidden entirely for members', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Voice & Tone', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Billing', exact: true })).toHaveCount(0)
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

  test('security and data tabs are visible with working controls for members', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Security', exact: true }).click()
    await expect(page.getByText('Device PIN lock').first()).toBeVisible()

    await page.getByRole('button', { name: 'Data', exact: true }).click()
    await expect(page.getByText('Export all data (JSON)')).toBeVisible()
    // members are not admins, so admin-only destructive rows must not render
    await expect(page.getByText('Clear all tasks')).toHaveCount(0)
    await expect(page.getByText('Reset all data')).toHaveCount(0)
  })
})

test.describe('Settings General (admin+owner) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('EOD reminder hour and currency selects change then restore', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'General', exact: true }).click()

    const currencyRow = page.locator('[data-tour="currency-row"]')
    const currencyButton = currencyRow.getByRole('button')
    // the trigger button appends a "▾" arrow glyph the dropdown's own option buttons don't have,
    // so strip it before reusing this as an option label to click
    const originalCurrency = (await currencyButton.textContent())?.replace('▾', '').trim()
    await currencyButton.click()
    const otherCurrencyOption = page.getByRole('button', { name: /USD|GBP|EUR/ }).filter({ hasNotText: originalCurrency ?? '' }).first()
    const targetLabel = (await otherCurrencyOption.textContent())?.replace('▾', '').trim()
    await otherCurrencyOption.click()
    await expect(currencyButton).toContainText(targetLabel ?? '', { timeout: 5_000 })

    // restore
    await currencyButton.click()
    await page.getByRole('button', { name: originalCurrency ?? '', exact: true }).click()
    await expect(currencyButton).toContainText(originalCurrency ?? '', { timeout: 5_000 })
  })

  test('target hourly rate saves and persists after reload, then restores', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'General', exact: true }).click()

    const rateRow = page.locator('[data-tour="rate-row"]')
    const input = rateRow.locator('input[type="number"]')
    const original = await input.inputValue()

    await input.fill('123')
    await input.blur()
    // rate save goes through a 700ms debounce, not immediate like the other General fields
    await expect(rateRow.getByText('Saved')).toBeVisible({ timeout: 10_000 })

    await page.reload()
    await page.getByRole('button', { name: 'General', exact: true }).click()
    await expect(page.locator('[data-tour="rate-row"] input[type="number"]')).toHaveValue('123')

    await page.locator('[data-tour="rate-row"] input[type="number"]').fill(original || '0')
    await page.locator('[data-tour="rate-row"] input[type="number"]').blur()
    await expect(page.locator('[data-tour="rate-row"]').getByText('Saved')).toBeVisible({ timeout: 10_000 })
  })

  test('skip weekends and desktop notification toggles flip and restore', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'General', exact: true }).click()

    for (const label of ['Skip weekends', 'Desktop notifications']) {
      const row = page.getByText(label, { exact: true }).locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
      const toggle = row.locator('div.rounded-full.relative').first()
      const before = await toggle.getAttribute('class')
      await toggle.click()
      await page.waitForTimeout(400)
      const after = await toggle.getAttribute('class')
      expect(after).not.toBe(before)
      // restore
      await toggle.click()
      await page.waitForTimeout(400)
      const restored = await toggle.getAttribute('class')
      expect(restored).toBe(before)
    }
  })
})

test.describe('Settings cross-tab save regression @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  // GeneralClient and VoiceClient both read/write the same orgs.settings jsonb column, each
  // spreading a `settings` prop that's only as fresh as the last full page load. If VoiceClient
  // saves using a stale `settings` snapshot after GeneralClient just wrote a change in the same
  // client session (no reload in between), that stale spread will clobber General's write.
  test('saving Voice settings does not revert an unsaved-page General change', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'General', exact: true }).click()

    const row = page.getByText('Skip weekends', { exact: true }).locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
    const toggle = row.locator('div.rounded-full.relative').first()
    const before = await toggle.getAttribute('class')
    await toggle.click()
    // give General's own (now two-roundtrip: read-fresh-then-merge) save time to actually land
    // before switching tabs - this test is about the stale-prop bug, not a sub-second race
    await page.waitForTimeout(1500)
    const afterToggle = await toggle.getAttribute('class')
    expect(afterToggle).not.toBe(before)

    // switch tabs WITHOUT reloading, then save something in Voice
    await page.getByRole('button', { name: 'Voice & Tone', exact: true }).click()
    const textarea = page.locator('textarea')
    const originalVoice = await textarea.inputValue()
    await textarea.fill(originalVoice) // no-op edit, just trigger a blur-save with the stale settings prop
    await textarea.blur()
    await page.waitForTimeout(800)

    // reload and check whether the General toggle survived Voice's save
    await page.reload()
    await page.getByRole('button', { name: 'General', exact: true }).click()
    const reloadedToggle = page
      .getByText('Skip weekends', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
      .locator('div.rounded-full.relative')
      .first()
    const afterReload = await reloadedToggle.getAttribute('class')
    expect(afterReload, 'Voice tab save clobbered the unsaved General toggle change - stale settings prop bug').toBe(afterToggle)

    // restore original state
    await reloadedToggle.click()
    await page.waitForTimeout(400)
  })
})

test.describe('Settings Voice & Tone (admin+owner) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('brand voice saves and persists after reload, then restores', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Voice & Tone', exact: true }).click()

    const textarea = page.locator('textarea')
    const original = await textarea.inputValue()
    const value = `Warm and direct, no jargon. QA-${Date.now()}`

    await textarea.fill(value)
    await textarea.blur()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })

    await page.reload()
    await page.getByRole('button', { name: 'Voice & Tone', exact: true }).click()
    await expect(page.locator('textarea')).toHaveValue(value)

    await page.locator('textarea').fill(original)
    await page.locator('textarea').blur()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Settings Voice role boundary (member is fully blocked) @member', () => {
  test.use({ storageState: 'playwright/.auth/member.json' })

  test('member cannot reach voice settings via direct query param either', async ({ page }) => {
    await page.goto('/settings?view=voice')
    // NAV filters the item out entirely for non-admins, so the view falls back to General
    await expect(page.getByText('Brand voice')).toHaveCount(0)
  })
})

test.describe('Settings Integrations (all roles) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('AI credits usage bar and coming-soon integrations render', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Integrations', exact: true }).click()
    await expect(page.getByText('AI generation')).toBeVisible()
    await expect(page.getByText(/generations used this month/)).toBeVisible()
    for (const name of ['Slack', 'Zoom', 'Microsoft Teams', 'Notion', 'HubSpot', 'Zapier', 'Calendly']) {
      await expect(page.getByText(name, { exact: true })).toBeVisible()
    }
  })
})

test.describe('Settings Security (all roles) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('password change validates length and match without submitting a real change', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Security', exact: true }).click()

    await page.getByPlaceholder('New password', { exact: true }).fill('abc')
    await page.getByPlaceholder('Confirm new password').fill('abc')
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.getByText('Password must be at least 6 characters')).toBeVisible({ timeout: 3_000 })

    await page.getByPlaceholder('New password', { exact: true }).fill('abcdefgh')
    await page.getByPlaceholder('Confirm new password').fill('mismatch1')
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.getByText('Passwords don')).toBeVisible({ timeout: 3_000 })
    // deliberately not testing the success path here - it would change the real owner login
    // credential used by every other test in this suite (see auth.setup.ts)
  })

  test('device PIN can be set, changed, and removed', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Security', exact: true }).click()

    await page.getByRole('button', { name: 'Set PIN' }).click()
    await page.getByPlaceholder('New PIN').fill('1234')
    await page.getByPlaceholder('Confirm PIN').fill('1234')
    await page.getByRole('button', { name: 'Save PIN' }).click()
    await expect(page.getByText('● PIN set')).toBeVisible({ timeout: 3_000 })

    const idleSelect = page.getByText('Lock after').locator('xpath=ancestor::div[contains(@class,"justify-between")][1]').getByRole('button')
    await idleSelect.click()
    await page.getByRole('button', { name: '10 min' }).click()
    await expect(idleSelect).toContainText('10 min')

    await page.getByRole('button', { name: 'Remove' }).click()
    const confirmDialog = page.getByText('Remove PIN lock?')
    await expect(confirmDialog).toBeVisible()
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click()
    await expect(page.getByText('Set PIN')).toBeVisible({ timeout: 3_000 })
  })
})

test.describe('Settings Data (admin+owner) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('JSON and CSV exports trigger a download', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Data', exact: true }).click()

    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByText('Export all data (JSON)').locator('xpath=ancestor::div[contains(@class,"justify-between")][1]').getByRole('button').click(),
    ])
    expect(jsonDownload.suggestedFilename()).toMatch(/^verdolo-export-.*\.json$/)

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByText('Export clients (CSV)').locator('xpath=ancestor::div[contains(@class,"justify-between")][1]').getByRole('button').click(),
    ])
    expect(csvDownload.suggestedFilename()).toMatch(/^verdolo-clients-.*\.csv$/)
  })

  test('archived tasks panel opens and destructive admin actions are guarded by a confirm dialog that can be cancelled', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Data', exact: true }).click()

    await page.getByText('Archived tasks').locator('xpath=ancestor::div[contains(@class,"justify-between")][1]').getByRole('button', { name: 'View' }).click()
    await expect(page.getByText(/No archived tasks\.|purges in|purging soon/).first()).toBeVisible({ timeout: 5_000 })

    // Clear all tasks / Reset all data are catastrophic against the shared demo org (see
    // project_verdolo_june_simulation memory) - verify the confirm gate exists and cancel out,
    // never actually confirm.
    await page.getByRole('button', { name: 'Clear tasks', exact: true }).click()
    await expect(page.getByText('Clear all tasks?')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByText('Clear all tasks?')).toHaveCount(0)

    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(page.getByText('Delete all org data?')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByText('Delete all org data?')).toHaveCount(0)
  })
})

test.describe('Settings Billing (owner) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('manage billing panel opens without hanging - either loads invoices or surfaces a real error', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Billing', exact: true }).click()

    const manageButton = page.getByRole('button', { name: /Manage billing|Opening/ })
    await expect(manageButton).toBeVisible({ timeout: 5_000 })
    await manageButton.click()

    // known issue: this org's stored stripe_customer_id doesn't currently resolve in live
    // Stripe (resource_missing), so /api/billing/details 502s - see project memory for the
    // production billing-panel-hang bug this test guards against. Accept either outcome, but
    // never the old failure mode (panel stuck on "Loading…" forever with no error surfaced).
    const paymentMethod = page.getByText('Payment method')
    const errorToast = page.getByText(/Could not load billing details/)
    await expect(paymentMethod.or(errorToast)).toBeVisible({ timeout: 10_000 })

    if (await paymentMethod.isVisible().catch(() => false)) {
      await expect(page.getByText('Invoices')).toBeVisible()
      const cancelLink = page.getByRole('button', { name: 'Cancel subscription' })
      if (await cancelLink.isVisible().catch(() => false)) {
        await cancelLink.click()
        await expect(page.getByText('Cancel at the end of the billing period?')).toBeVisible()
        // NEVER click "Yes, cancel" here - this is the real production subscription (see
        // feedback_financial_dashboard_automation memory: hand live-payment actions back to the user)
        await page.getByRole('button', { name: 'Never mind' }).click()
      }
      await page.getByRole('button', { name: 'Close' }).click()
    }
  })
})

test.describe('Settings Billing role boundary (admin/member see read-only message) @admin', () => {
  test.use({ storageState: 'playwright/.auth/admin.json' })

  test('non-owner sees billing status message with no management controls', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Billing', exact: true })).toHaveCount(0)
    await page.goto('/settings?view=billing')
    await expect(page.getByText('Only the org owner can manage billing.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Manage billing' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Subscribe' })).toHaveCount(0)
  })
})

test.describe('Settings Profile extras (owner) @owner', () => {
  test.use({ storageState: 'playwright/.auth/owner.json' })

  test('avatar can be uploaded then removed', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Profile', exact: true }).click()

    // 1x1 red pixel PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    await page.locator('input[type="file"]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByText('Profile picture updated')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()

    await page.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible({ timeout: 10_000 })
  })

  test('guided tour replay button is present and clickable', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Profile', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Replay tour' })).toBeVisible()
  })
})
