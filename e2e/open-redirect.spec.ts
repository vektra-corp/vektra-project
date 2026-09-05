import { expect, test } from '@playwright/test'
import { ACCOUNTS, ORG_SLUG } from './fixtures'

/**
 * Open redirect on the `next` parameter (§13.4).
 *
 * Flagged by a security review of the MFA action, and present in the sign-in
 * action too: `next.startsWith('/')` accepts `//evil.example`, which is a
 * protocol-relative URL the browser resolves to another site.
 *
 * HONEST NOTE ON WHAT THIS PROVES. These tests pass against the UNFIXED code —
 * checked by reverting it — because this version of Next normalises a
 * protocol-relative Location from a server action before the browser sees it.
 * So the bug was not exploitable end to end here, and these are a regression
 * guard rather than a demonstration.
 *
 * The fix is still right. Relying on a framework's incidental normalisation for
 * a security property is exactly the kind of assumption that breaks quietly on
 * an upgrade, and `safeNextPath` is unit-tested against every variant directly —
 * that is where the real coverage is (`packages/auth`).
 */
test.use({ storageState: { cookies: [], origins: [] } })

const HOSTILE = ['//evil.example', '//evil.example/path', '/\\evil.example', 'https://evil.example']

for (const next of HOSTILE) {
  test(`sign-in does not follow next=${next}`, async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent(next)}`)
    await page.getByLabel('Email', { exact: true }).fill(ACCOUNTS.owner.email)
    await page.getByLabel('Password', { exact: true }).fill(ACCOUNTS.owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL((url) => new URL(url).pathname !== '/login', { timeout: 30_000 })

    // Whatever happened, the browser must still be on our origin.
    expect(new URL(page.url()).hostname).toBe('127.0.0.1')
    expect(page.url()).not.toContain('evil.example')
  })
}

test('a legitimate next is still honoured', async ({ page }) => {
  // The guard must not be so blunt that it breaks the feature it protects.
  const destination = `/${ORG_SLUG}/reports`
  await page.goto(`/login?next=${encodeURIComponent(destination)}`)
  await page.getByLabel('Email', { exact: true }).fill(ACCOUNTS.owner.email)
  await page.getByLabel('Password', { exact: true }).fill(ACCOUNTS.owner.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  await expect(page).toHaveURL(new RegExp(`${ORG_SLUG}/reports`), { timeout: 30_000 })
})
