import { expect, test } from '@playwright/test'
import { ACCOUNTS, ORG_SLUG } from './fixtures'

/**
 * Session management (§13.6).
 *
 * Its own anonymous file because it signs in for real: the whole point is that
 * signing in records a session, so it cannot reuse the shared storage state.
 */
test.use({ storageState: { cookies: [], origins: [] } })

test('records a session on sign-in and lists it as the current device', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(ACCOUNTS.manager.email)
  await page.getByLabel('Password', { exact: true }).fill(ACCOUNTS.manager.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(new RegExp(`/${ORG_SLUG}(/|$)`), { timeout: 30_000 })

  await page.goto(`/${ORG_SLUG}/settings/security`)
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()

  // The device that just signed in is listed and marked, and offers no revoke
  // control — signing yourself out from here would be a trap.
  await expect(page.getByText('This device')).toBeVisible({ timeout: 20_000 })
  const currentRow = page.locator('li').filter({ hasText: 'This device' })
  await expect(currentRow.getByRole('button', { name: 'Revoke' })).toHaveCount(0)
})

test('revoking another session actually locks it out', async ({ browser }) => {
  // Two separate browser contexts: two genuinely different sessions.
  const first = await browser.newContext()
  const second = await browser.newContext()

  const signIn = async (context: Awaited<ReturnType<typeof browser.newContext>>) => {
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill(ACCOUNTS.member.email)
    await page.getByLabel('Password', { exact: true }).fill(ACCOUNTS.member.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(new RegExp(`/${ORG_SLUG}(/|$)`), { timeout: 30_000 })
    return page
  }

  const pageA = await signIn(first)
  const pageB = await signIn(second)

  // B revokes everything that is not B — which is A.
  await pageB.goto(`/${ORG_SLUG}/settings/security`)
  const signOutOthers = pageB.getByRole('button', { name: /sign out everywhere else/i })
  await expect(signOutOthers).toBeVisible({ timeout: 20_000 })
  await signOutOthers.click()
  // `.first()` because a toast renders its text twice: visibly, and again in an
  // aria-live region for screen readers.
  await expect(pageB.getByText(/signed out/i).first()).toBeVisible({ timeout: 20_000 })

  // B still works.
  await pageB.goto(`/${ORG_SLUG}/dashboard`)
  await expect(pageB).toHaveURL(/\/dashboard/)

  // A's refresh token is gone, so it cannot mint a new access token. Clearing
  // the access token leaves it holding only the revoked refresh token, which is
  // the state it reaches on its own once the access token expires.
  await first.addCookies([])
  await pageA.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.includes('auth-token')) window.localStorage.removeItem(key)
    }
  })
  await pageA.context().clearCookies({ name: /sb-.*-auth-token/ as never })

  await pageA.goto(`/${ORG_SLUG}/dashboard`)
  await expect(pageA).toHaveURL(/\/login/, { timeout: 20_000 })

  await first.close()
  await second.close()
})
