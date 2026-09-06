import { expect, test } from '@playwright/test'
import { ORG_SLUG, STORAGE_STATE, WORKSPACE_SLUG, projectPath } from './fixtures'

test.use({ storageState: STORAGE_STATE })

/**
 * Every authenticated route renders.
 *
 * This is the spec that pays for the whole suite. Two bugs in this project took
 * down every page in the org shell, and both were invisible to `tsc`, ESLint
 * and the unit tests:
 *
 *   - the sidebar passing a Lucide icon (a function) from a server component to
 *     a client one, which cannot be serialised across the RSC boundary;
 *   - a component exported as `AuditFilters.Pager` rather than as a named
 *     export, which the React client manifest cannot resolve.
 *
 * Both produced a 500 on first request and nothing at build time. A test that
 * merely loads each page catches that entire class.
 *
 * So the assertions here are deliberately shallow — a heading, a landmark, no
 * error boundary. Depth belongs in the flow specs; breadth belongs here.
 */

const ROUTES: { path: string; expect: RegExp }[] = [
  { path: `/${ORG_SLUG}/dashboard`, expect: /dashboard/i },
  { path: `/${ORG_SLUG}/my-tasks`, expect: /tasks/i },
  { path: `/${ORG_SLUG}/reports`, expect: /report/i },
  { path: `/${ORG_SLUG}/revenue`, expect: /revenue/i },
  { path: `/${ORG_SLUG}/team`, expect: /team|people|member/i },
  { path: `/${ORG_SLUG}/settings/profile`, expect: /profile/i },
  { path: `/${ORG_SLUG}/settings/general`, expect: /general|organization/i },
  { path: `/${ORG_SLUG}/settings/custom-fields`, expect: /custom field/i },
  { path: `/${ORG_SLUG}/settings/integrations`, expect: /integration/i },
  { path: `/${ORG_SLUG}/settings/audit-log`, expect: /audit/i },
  { path: `/${ORG_SLUG}/settings/data`, expect: /import|export/i },
  { path: `/${ORG_SLUG}/settings/billing`, expect: /billing|plan/i },
  { path: `/${ORG_SLUG}/${WORKSPACE_SLUG}/projects`, expect: /project/i },
  { path: `/${ORG_SLUG}/${WORKSPACE_SLUG}/workflows`, expect: /workflow/i },
  { path: `/${ORG_SLUG}/${WORKSPACE_SLUG}/commercial/contacts`, expect: /contact/i },
  { path: `/${ORG_SLUG}/${WORKSPACE_SLUG}/commercial/quotations`, expect: /quotation/i },
  { path: `/${ORG_SLUG}/${WORKSPACE_SLUG}/commercial/templates`, expect: /template/i },
  { path: projectPath('board'), expect: /board|to do/i },
  { path: projectPath('list'), expect: /list|title/i },
  { path: projectPath('timeline'), expect: /timeline|plan/i },
  { path: projectPath('documents'), expect: /document/i },
  { path: projectPath('settings'), expect: /project|status/i },
]

for (const route of ROUTES) {
  test(`renders ${route.path}`, async ({ page }) => {
    const response = await page.goto(route.path)

    // A 500 from a server component is the exact failure this guards.
    expect(response?.status(), `${route.path} returned ${response?.status()}`).toBeLessThan(400)

    // Next renders its error boundary with a 200, so status alone is not enough.
    await expect(page.locator('body')).not.toContainText(
      /Application error|Internal Server Error|Unhandled Runtime Error/i,
    )

    await expect(page.locator('body')).toContainText(route.expect)
  })
}

test('another tenant’s project is not reachable by URL', async ({ page }) => {
  // Layer 3 of §22.4 seen from the outside: RLS returns nothing, and the app
  // turns that into a 404 rather than an empty page that looks broken.
  const globexProject = 'b2b2b2b2-0000-0000-0000-000000000001'
  const response = await page.goto(
    `/${ORG_SLUG}/${WORKSPACE_SLUG}/projects/${globexProject}/board`,
  )

  expect(response?.status()).toBe(404)
})

test('an unknown project id 404s rather than erroring', async ({ page }) => {
  const response = await page.goto(
    `/${ORG_SLUG}/${WORKSPACE_SLUG}/projects/00000000-0000-0000-0000-000000000000/board`,
  )
  expect(response?.status()).toBe(404)
})
