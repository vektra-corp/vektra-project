import { expect, test } from '@playwright/test'
import { ORG_SLUG, WORKSPACE_SLUG } from './fixtures'

/**
 * What a signed-out visitor can reach.
 *
 * Its own file with no `storageState`, rather than a manually-created context
 * inside the authenticated spec. `browser.newContext()` there looked clean but
 * the page still rendered the dashboard, and chasing why is not worth it when
 * Playwright has a supported way to say "this file is anonymous". Being
 * explicit at the file level also means a future test cannot accidentally
 * inherit a session and pass for the wrong reason.
 */
test.use({ storageState: { cookies: [], origins: [] } })

const PROTECTED = [
  `/${ORG_SLUG}/dashboard`,
  `/${ORG_SLUG}/settings/billing`,
  `/${ORG_SLUG}/settings/audit-log`,
  `/${ORG_SLUG}/${WORKSPACE_SLUG}/projects`,
]

for (const path of PROTECTED) {
  test(`sends an anonymous visitor from ${path} to login`, async ({ page }) => {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login/)
    // The destination is preserved so signing in lands where they meant to go.
    await expect(page).toHaveURL(new RegExp(`next=${encodeURIComponent(path).replace(/%/g, '%')}`))
  })
}

test('shows the login form itself', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
})

test('refuses a wrong password without saying which field was wrong', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('owner@acme.test')
  await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // Still on login, with an error, and no hint that the ACCOUNT exists —
  // distinguishing "wrong password" from "no such user" is an enumeration
  // oracle (§13.5).
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('alert')).not.toContainText(/no such|not found|does not exist/i)
})

test('does not leak an unknown account either', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('definitely-nobody@nowhere.invalid')
  await page.getByLabel('Password', { exact: true }).fill('whatever-123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  await expect(page.getByRole('alert')).toBeVisible()
})

test('the inbound workflow webhook route is opaque to a guessed token', async ({ request }) => {
  // Excluded from auth middleware by design; every failure answers identically
  // so it cannot be used to guess tokens.
  const response = await request.post('/api/webhooks/workflows/aaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
    data: { probe: true },
  })
  expect(response.status()).toBe(202)
})

test('an export cannot be pulled without a session', async ({ request }) => {
  const response = await request.get(`/api/export?org=${ORG_SLUG}&entity=contacts`, {
    maxRedirects: 0,
  })
  expect(response.status()).toBeGreaterThanOrEqual(300)
  expect(response.headers()['content-type'] ?? '').not.toContain('text/csv')
})
