import { defineConfig, devices } from '@playwright/test'
import fs from 'fs'
import path from 'path'

for (const file of ['.env.local', '.env.test']) {
  const p = path.join(__dirname, file)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    const key = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim().replace(/^"|"$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'owner',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/owner.json' },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
      grep: /@owner/,
    },
    {
      name: 'admin',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/admin.json' },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
      grep: /@admin/,
    },
    {
      name: 'member',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/member.json' },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
      grep: /@member/,
    },
  ],
})
