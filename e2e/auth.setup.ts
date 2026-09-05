import { expect, test as setup } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { ACCOUNTS, ORG_SLUG, STORAGE_STATE } from './fixtures'

/**
 * Sign in once and save the session for every other spec.
 *
 * This is also the auth flow test (§14): if it fails, no other spec can run,
 * and the reason will be legible here rather than as thirty redirect failures
 * somewhere else.
 *
 * Signing in through the form rather than by minting a token is deliberate.
 * Fabricating a session cookie would skip the middleware, the org resolution and
 * the JWT hook — three of the places most likely to break.
 */
setup('signs in and stores the session', async ({ page }) => {
  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })

  await page.goto('/login')

  // The form is server-rendered, so its fields exist before any JS runs.
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()

  await page.getByLabel('Email', { exact: true }).fill(ACCOUNTS.owner.email)
  // Exact, because the reveal toggle's aria-label is "Show password" and a
  // loose match resolves to both the field and the button.
  await page.getByLabel('Password', { exact: true }).fill(ACCOUNTS.owner.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // Landing anywhere inside the org is success; the exact destination depends
  // on which org the account defaults to.
  await page.waitForURL(new RegExp(`/${ORG_SLUG}(/|$)`), { timeout: 30_000 })

  // A redirect alone is not proof — an error page under the same URL would also
  // satisfy it. Wait for chrome only a signed-in page renders.
  await expect(page.getByRole('navigation').first()).toBeVisible()

  await page.context().storageState({ path: STORAGE_STATE })
})
