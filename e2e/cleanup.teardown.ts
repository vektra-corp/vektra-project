import { test as teardown } from '@playwright/test'
import { Client } from 'pg'

/**
 * Remove what the suite created.
 *
 * Without this the seeded board accumulates a handful of tasks per run and
 * gets steadily slower, until specs that pass in isolation start timing out in
 * a full run — which is exactly what happened, and looked like flake rather
 * than the housekeeping problem it was.
 *
 * This is the one place the suite touches the database directly. Everything
 * else goes through the app on purpose; cleanup cannot, because there is no
 * bulk-delete in the UI and driving one deletion at a time through a browser
 * would cost more than the tests.
 */
teardown('removes records created by the run', async () => {
  const url = process.env.SUPABASE_DB_URL
  if (!url) return

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    // Titles are prefixed and made unique by `unique()`, so this cannot reach
    // anything a person created.
    const subtasks = await client.query(`DELETE FROM subtasks WHERE title LIKE 'E2E %'`)
    const tasks = await client.query(`DELETE FROM tasks WHERE title LIKE 'E2E %'`)
    // Factors and sessions belong to the fixture accounts and are re-made on
    // the next run; leaving a verified factor behind would make every later
    // sign-in demand a code nobody has.
    const factors = await client.query(
      `DELETE FROM auth.mfa_factors WHERE user_id IN
         (SELECT id FROM auth.users WHERE email LIKE '%@acme.test')`,
    )
    const sessions = await client.query(`DELETE FROM user_sessions`)

    // eslint-disable-next-line no-console -- the whole point of a teardown step
    console.log(
      `cleanup: ${tasks.rowCount} tasks, ${subtasks.rowCount} subtasks, ` +
        `${factors.rowCount} MFA factors, ${sessions.rowCount} session rows`,
    )
  } finally {
    await client.end()
  }
})
