import { expect, test, type Page } from '@playwright/test'
import { ORG_SLUG, STORAGE_STATE, WORKSPACE_SLUG } from './fixtures'

/**
 * A project URL read from the running app rather than from a fixture constant.
 *
 * The id in the URL is the row's `public_id`, not its uuid, and a hard-coded one
 * goes stale the moment the seed changes. Following the first link on the
 * project list keeps this spec honest about whatever scheme the app currently
 * uses.
 */
async function firstProjectPath(page: Page, view: string): Promise<string> {
  await page.goto(`/${ORG_SLUG}/${WORKSPACE_SLUG}/projects`)
  // `:not([href$="/new"])` matters: the "New project" button lives on this list
  // and matches the same prefix, and /projects/new/board is a 404.
  const link = page
    .locator(`a[href*="/${WORKSPACE_SLUG}/projects/"]:not([href$="/new"])`)
    .first()

  // A short explicit wait, so an empty list reports itself in seconds instead of
  // sitting on the test timeout with nothing to say.
  await expect(
    link,
    'no project link on the project list — seed not loaded, or the list is failing to render',
  ).toBeAttached({ timeout: 10_000 })

  const href = await link.getAttribute('href')
  expect(href).toBeTruthy()
  const base = href!.replace(/\/(board|list|timeline|planning|workload|documents|settings).*$/, '')
  return `${base}/${view}`
}

test.use({ storageState: STORAGE_STATE })

/**
 * Navigation gives feedback before the data arrives.
 *
 * The app previously had no `loading.tsx` and no `<Suspense>` anywhere, so the
 * App Router held the PREVIOUS page on screen, frozen, for the whole server
 * render — a click looked like it had done nothing. These tests fail if that
 * regresses.
 *
 * The skeleton assertions read the streamed HTML rather than looking for a
 * flash in the browser. By the time Playwright considers a page loaded, React
 * has already swapped the fallback out, so a DOM assertion would be racing the
 * very thing it is trying to observe. The server response is the honest record:
 * if the shell was flushed before the data resolved, the skeleton markup is in
 * it.
 */

/** Class fragment emitted by the shared `Skeleton` primitive. */
const SKELETON = 'animate-pulse'

test.describe('route-level loading boundaries', () => {
  // Each of these routes is compiled on demand by `next dev` on first request,
  // which on a cold cache is far slower than any real page load.
  test.setTimeout(240_000)

  // Distinctive geometry from each variant, so the test proves the RIGHT
  // fallback was chosen rather than merely that some skeleton exists.
  const cases: { name: string; path: string | ((page: Page) => Promise<string>); markers: string[] }[] = [
    { name: 'reports', path: `/${ORG_SLUG}/reports`, markers: ['h-3.5 flex-[3]'] },
    { name: 'my-tasks', path: `/${ORG_SLUG}/my-tasks`, markers: ['h-3.5 flex-[3]'] },
    { name: 'dashboard', path: `/${ORG_SLUG}/dashboard`, markers: ['h-7 w-7 rounded-md'] },
    { name: 'project board', path: (page) => firstProjectPath(page, 'board'), markers: ['w-[280px]'] },
    { name: 'project timeline', path: (page) => firstProjectPath(page, 'timeline'), markers: ['h-3.5 w-40 shrink-0'] },
  ]

  for (const { name, path, markers } of cases) {
    test(`${name} streams a skeleton before its data`, async ({ page }) => {
      const url = typeof path === 'string' ? path : await path(page)

      // Warm the dev compiler first: a cold compile is not what is under test.
      await page.request.get(url)

      const response = await page.request.get(url)
      expect(response.status()).toBeLessThan(400)
      const html = await response.text()

      expect(html, `${url} streamed no skeleton`).toContain(SKELETON)
      for (const marker of markers) {
        expect(html, `${url} used the wrong skeleton variant`).toContain(marker)
      }
    })
  }
})

test('the clicked sidebar row reports itself as pending immediately', async ({ page }) => {
  await page.goto(`/${ORG_SLUG}/dashboard`)
  await expect(page.getByRole('navigation').first()).toBeVisible()

  // Hold the RSC payload so the click has something to be pending THROUGH.
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.url().includes('_rsc=') || request.headers()['rsc'] !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
    await route.continue()
  })

  const link = page.getByRole('link', { name: /^Reports$/ }).first()
  await link.click()

  // Set synchronously inside the transition, so it is present long before any
  // response. This is the part that works even in development, where Next
  // disables prefetching and the loading boundary is therefore not cached.
  await expect(link).toHaveAttribute('data-pending', '', { timeout: 1000 })
})

test('every section that got a boundary still renders', async ({ page }) => {
  test.setTimeout(300_000)

  const sections = [
    `/${ORG_SLUG}/dashboard`,
    `/${ORG_SLUG}/my-tasks`,
    `/${ORG_SLUG}/reports`,
    `/${ORG_SLUG}/members`,
    `/${ORG_SLUG}/timesheets`,
    `/${ORG_SLUG}/settings/profile`,
    `/${ORG_SLUG}/${WORKSPACE_SLUG}/projects`,
    `/${ORG_SLUG}/${WORKSPACE_SLUG}/workflows`,
    await firstProjectPath(page, 'board'),
    await firstProjectPath(page, 'list'),
    await firstProjectPath(page, 'timeline'),
  ]

  const broken: string[] = []
  for (const path of sections) {
    // Drive a real navigation rather than reading the raw response. Once a
    // loading.tsx has flushed, the status is already 200, so a notFound() or a
    // caught error later in the stream is invisible to a status check — it is
    // only visible in what finally renders.
    await page.goto(path)
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    const failure = /Could not load[^.]*\.?|Application error|Internal Server Error|could not be found/i.exec(body)
    if (failure) {
      broken.push(`${path} -> ${failure[0]}`)
    }
  }

  expect(broken.join(' | ')).toBe('')
})

test('the commercial section renders one header, not two', async ({ page }) => {
  // templates/page.tsx used to render its own <Topbar> underneath the one the
  // commercial layout already provides: two stacked headers, and the same
  // org_members query run twice.
  await page.goto(`/${ORG_SLUG}/${WORKSPACE_SLUG}/commercial/templates`)
  await expect(page.getByRole('banner')).toHaveCount(1)
})
