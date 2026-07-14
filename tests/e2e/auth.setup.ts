import { test as setup, expect } from '@playwright/test'

const roles = [
  { role: 'owner', emailVar: 'TEST_OWNER_EMAIL', passwordVar: 'TEST_OWNER_PASSWORD' },
  { role: 'admin', emailVar: 'TEST_ADMIN_EMAIL', passwordVar: 'TEST_ADMIN_PASSWORD' },
  { role: 'member', emailVar: 'TEST_MEMBER_EMAIL', passwordVar: 'TEST_MEMBER_PASSWORD' },
] as const

for (const { role, emailVar, passwordVar } of roles) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    const email = process.env[emailVar]
    const password = process.env[passwordVar]
    if (!email || !password) throw new Error(`Missing ${emailVar}/${passwordVar} in .env.test`)

    await page.goto('/login')
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password').fill(password)
    await page.getByRole('button', { name: /log in/i }).click()

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    await page.context().storageState({ path: `playwright/.auth/${role}.json` })
  })
}
