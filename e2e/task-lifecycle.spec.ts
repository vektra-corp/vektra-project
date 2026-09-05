import { expect, test } from '@playwright/test'
import { STORAGE_STATE, clickUntil, projectPath, unique } from './fixtures'

test.use({ storageState: STORAGE_STATE })

/**
 * The task journey from §14: create a task on the board, open it, work on it,
 * and see it reflected elsewhere.
 *
 * These run against the seeded Acme project and create their own tasks with
 * run-unique titles, so a leftover from a previous run cannot make a later one
 * pass or fail by accident.
 *
 * Business rule 3 is the thing most worth guarding here: the Kanban column owns
 * the status, and there is no write path that changes one without the other. A
 * regression there shows as a card reading "Done" while sitting in In Progress
 * — visible only in a browser.
 */

test('creates a task from the board and opens it', async ({ page }) => {
  const title = unique('E2E task')

  await page.goto(projectPath('board'))
  await expect(page.getByRole('heading', { name: /to do/i }).first()).toBeVisible()

  // The quick-add composer at the foot of the first column.
  await clickUntil(
    expect,
    () => page.getByRole('button', { name: 'Add issue' }).first().click(),
    () => expect(page.getByLabel('Task title')).toBeVisible({ timeout: 2_000 }),
  )
  await page.getByLabel('Task title').fill(title)
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  // The card appears on the board without a manual reload. Targeted by role
  // because a card renders its title twice — the visible link, and a screen-
  // reader label on the "mark as done" toggle.
  const card = page.getByRole('link', { name: title })
  await expect(card).toBeVisible({ timeout: 20_000 })

  // And the detail page opens from it.
  await card.click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}/)
})

test('a new task appears in the list view too', async ({ page }) => {
  const title = unique('E2E listed')

  await page.goto(projectPath('board'))
  await clickUntil(
    expect,
    () => page.getByRole('button', { name: 'Add issue' }).first().click(),
    () => expect(page.getByLabel('Task title')).toBeVisible({ timeout: 2_000 }),
  )
  await page.getByLabel('Task title').fill(title)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 20_000 })

  // Board and list read the same rows; a divergence here means one of them is
  // filtering something the other is not.
  await page.goto(projectPath('list'))
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 })
})

test('a task detail page shows its subtask board link and the board provisions', async ({
  page,
}) => {
  await page.goto(projectPath('board'))

  // Open whichever task the seed put first rather than a hard-coded id.
  const firstCard = page.locator('a[href*="/tasks/"]').first()
  await expect(firstCard).toBeVisible({ timeout: 20_000 })
  await firstCard.click()

  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}/)

  const openBoard = page.getByRole('link', { name: /open subtask board/i })
  await expect(openBoard).toBeVisible()
  await openBoard.click()

  // ensure_task_board runs on load; if it failed the page would 500 or show no
  // columns at all.
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}\/board/)
  for (const column of ['To Do', 'In Progress', 'In Review', 'Done']) {
    await expect(page.getByRole('heading', { name: column })).toBeVisible()
  }
})

test('adds a subtask from its board column', async ({ page }) => {
  const title = unique('E2E subtask')

  await page.goto(projectPath('board'))
  const firstCard = page.locator('a[href*="/tasks/"]').first()
  await expect(firstCard).toBeVisible({ timeout: 20_000 })
  const href = await firstCard.getAttribute('href')
  await page.goto(`${href}/board`)

  await clickUntil(
    expect,
    () => page.getByRole('button', { name: 'Add subtask' }).first().click(),
    () => expect(page.getByLabel('Subtask title')).toBeVisible({ timeout: 2_000 }),
  )
  await page.getByLabel('Subtask title').fill(title)
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 })
})

test('the board and the report agree on what exists', async ({ page }) => {
  const title = unique('E2E reported')

  await page.goto(projectPath('board'))
  await clickUntil(
    expect,
    () => page.getByRole('button', { name: 'Add issue' }).first().click(),
    () => expect(page.getByLabel('Task title')).toBeVisible({ timeout: 2_000 }),
  )
  await page.getByLabel('Task title').fill(title)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 20_000 })

  // The report reads through a different query path than the board; a task
  // visible in one and not the other has been seen before in this codebase.
  await page.goto('/acme/reports')
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 })
})
