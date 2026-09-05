import { expect, test } from '@playwright/test'
import { ACCOUNTS, ORG_SLUG } from './fixtures'
import { totp } from './totp'

/**
 * Two-step verification (§13.5).
 *
 * The point of these is the SECOND test: that a session which owes a code
 * cannot simply navigate around the prompt. Enrolment that is not enforced is
 * decorative, and enforcement is the part that is easy to get subtly wrong.
 *
 * Anonymous file — it signs in for real, several times.
 */
test.use({ storageState: { cookies: [], origins: [] } })

const account = ACCOUNTS.manager

/**
 * Sign in and confirm it worked.
 *
 * The explicit check matters: sign-in is rate limited to five attempts a minute
 * per IP (§13.7), and this spec signs in twice. When the limiter trips, the
 * page simply stays on /login — without this assertion the failure surfaces
 * thirty seconds later as an unrelated navigation timeout, which is how an
 * afternoon disappears.
 */
async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // Wait for an OUTCOME rather than for the network to go quiet: `networkidle`
  // can settle while the redirect is still in flight, which reads as "still on
  // /login" and produces a confident, wrong failure.
  await page
    .waitForURL((url) => new URL(url).pathname !== '/login', { timeout: 20_000 })
    .catch(async () => {
      // An empty live region for toasts exists on every page, so only text in
      // it counts as a refusal.
      const message = (await page.getByRole('alert').allInnerTexts().catch(() => []))
        .map((text) => text.trim())
        .filter(Boolean)
        .join(' ')

      throw new Error(
        message
          ? `Sign-in was refused: ${message}`
          : 'Sign-in did not proceed and gave no reason (the auth rate limit is 5/min)',
      )
    })
}

test('enrols, enforces on the next sign-in, and can be turned off', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await signIn(page)
  await page.waitForURL(new RegExp(`/${ORG_SLUG}(/|$)`), { timeout: 30_000 })

  // --- enrol ---
  await page.goto(`/${ORG_SLUG}/settings/security`)
  await page.getByRole('button', { name: 'Set up' }).click()

  const secretBox = page.locator('code').first()
  await expect(secretBox).toBeVisible({ timeout: 20_000 })
  const secret = ((await secretBox.textContent()) ?? '').trim()
  expect(secret.length).toBeGreaterThan(10)

  await expect(page.getByRole('img', { name: /qr code/i })).toBeVisible()

  await page.getByLabel('Code').fill(totp(secret))
  await page.getByRole('button', { name: 'Confirm' }).click()
  // "Turn off" appears only once a factor is verified — a less ambiguous signal
  // than the word "On", which occurs in plenty of other copy.
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible({ timeout: 20_000 })

  // --- enforcement ---
  //
  // Checked at the HTTP layer rather than by driving a second browser. The
  // property under test IS a redirect, and a browser adds no signal here while
  // adding a great deal of flake: two contexts signing in as the same account
  // also runs into the 5-per-minute auth limiter (§13.7).
  //
  // A fresh password sign-in yields an aal1 token. Every protected path must
  // answer with a redirect to /mfa, and /mfa itself must NOT — a challenge page
  // that redirects is a page nobody can complete, which is exactly the bug this
  // caught the first time it ran.
  const api = request

  const tokenResponse = await api.post(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', 'Content-Type': 'application/json' },
      data: { email: account.email, password: account.password },
    },
  )
  expect(tokenResponse.ok(), 'password sign-in should succeed').toBe(true)
  const token = (await tokenResponse.json()) as { access_token: string; refresh_token: string }

  const claims = JSON.parse(
    Buffer.from(token.access_token.split('.')[1] ?? '', 'base64url').toString(),
  ) as { aal?: string; exp: number; sub: string; email: string; role: string; aud: string }

  // Password alone leaves the session at aal1.
  expect(claims.aal).toBe('aal1')

  const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname.split('.')[0]
  const cookieValue =
    'base64-' +
    Buffer.from(
      JSON.stringify({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: claims.exp,
        user: { id: claims.sub, email: claims.email, role: claims.role, aud: claims.aud, app_metadata: {}, user_metadata: {} },
      }),
    ).toString('base64')

  const origin = new URL(page.url()).origin
  const fetchWith = (path: string) =>
    api.get(`${origin}${path}`, {
      headers: { Cookie: `sb-${projectRef}-auth-token=${cookieValue}` },
      maxRedirects: 0,
    })

  for (const path of ['/', `/${ORG_SLUG}/dashboard`, `/${ORG_SLUG}/settings/billing`]) {
    const response = await fetchWith(path)
    expect(response.status(), `${path} should redirect`).toBe(307)
    expect(response.headers().location ?? '', `${path} should go to /mfa`).toContain('/mfa')
  }

  // The challenge page itself must be reachable, or the person is trapped.
  const challenge = await fetchWith('/mfa')
  expect(challenge.status(), '/mfa must render, not redirect').toBe(200)

  // --- turn it off, so the fixture account is left as it was found ---
  await page.goto(`/${ORG_SLUG}/settings/security`)
  await page.getByRole('button', { name: 'Turn off' }).click()
  await expect(page.getByRole('button', { name: 'Set up' })).toBeVisible({ timeout: 20_000 })

  await context.close()
})
