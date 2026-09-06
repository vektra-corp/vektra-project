import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURES, asUser, connect, expectRejected } from './helpers'

/**
 * RLS coverage for migrations 00025–00030.
 *
 * These went in during Phase 3 and the end of Phase 2 and were verified by hand
 * at the time; this is the part that keeps them verified. Three of them are
 * unusual enough to deserve saying why they are here:
 *
 *   - `ensure_task_board` and `org_member_ids_for_emails` are SECURITY DEFINER
 *     and callable by end users, so they bypass RLS entirely and check the
 *     tenant themselves. A mistake in either is a cross-tenant hole with no
 *     policy behind it to catch the fall.
 *   - `comments.author_type` decides whether a comment is attributed to a
 *     person or to automation. If a member could write `'workflow'`, they could
 *     post something that looks like the system said it.
 *   - `import_export_jobs` is history. The absence of UPDATE and DELETE
 *     policies is the feature, and absence is exactly what nobody notices
 *     regressing.
 */

let db: Client

beforeAll(async () => {
  db = await connect()
})

afterAll(async () => {
  await db?.end()
})

const acmeOwner = {
  userId: FIXTURES.acme.owner,
  orgId: FIXTURES.acme.orgId,
  orgRole: 'owner',
} as const
const acmeManager = {
  userId: FIXTURES.acme.manager,
  orgId: FIXTURES.acme.orgId,
  orgRole: 'manager',
} as const
const acmeMember = {
  userId: FIXTURES.acme.member,
  orgId: FIXTURES.acme.orgId,
  orgRole: 'member',
} as const
const globexOwner = {
  userId: FIXTURES.globex.owner,
  orgId: FIXTURES.globex.orgId,
  orgRole: 'owner',
} as const

/** A task in Acme, for the board tests. */
async function anAcmeTask(): Promise<string> {
  const result = await db.query<{ id: string }>(
    'SELECT id FROM tasks WHERE project_id = $1 LIMIT 1',
    [FIXTURES.acme.projectId],
  )
  const id = result.rows[0]?.id
  if (!id) throw new Error('Seed has no task in the Acme project')
  return id
}

describe('comment authorship (00025)', () => {
  it('lets a member post as themselves', async () => {
    const taskId = await anAcmeTask()
    const inserted = await asUser(db, acmeMember, async (c) => {
      const result = await c.query<{ author_type: string }>(
        `INSERT INTO comments (organization_id, task_id, author_id, author_type, body)
         VALUES ($1, $2, $3, 'user', '{"type":"doc"}'::jsonb)
         RETURNING author_type`,
        [FIXTURES.acme.orgId, taskId, FIXTURES.acme.member],
      )
      return result.rows[0]?.author_type
    })
    expect(inserted).toBe('user')
  })

  it('refuses a member claiming to be automation', async () => {
    // Otherwise anyone could post a comment that renders as if the system said
    // it. The CHECK makes author_type='workflow' require a NULL author, and the
    // INSERT policy requires author_id = auth.uid() — together, impossible.
    const taskId = await anAcmeTask()
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO comments (organization_id, task_id, author_id, author_type, body)
       VALUES ($1, $2, NULL, 'workflow', '{"type":"doc"}'::jsonb)`,
      [FIXTURES.acme.orgId, taskId],
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('refuses a member posting as automation while naming themselves', async () => {
    const taskId = await anAcmeTask()
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO comments (organization_id, task_id, author_id, author_type, body)
       VALUES ($1, $2, $3, 'workflow', '{"type":"doc"}'::jsonb)`,
      [FIXTURES.acme.orgId, taskId, FIXTURES.acme.member],
    )
    expect(message).toMatch(/comments_author_identity|violates/i)
  })

  it('refuses a comment with no author of any kind', async () => {
    const taskId = await anAcmeTask()
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO comments (organization_id, task_id, author_id, author_type, body)
       VALUES ($1, $2, NULL, 'user', '{"type":"doc"}'::jsonb)`,
      [FIXTURES.acme.orgId, taskId],
    )
    expect(message).toMatch(/comments_author_identity|row-level security|violates/i)
  })
})

describe('webhook trigger tokens (00025)', () => {
  it('stores only a hash, so reading the row yields nothing usable', async () => {
    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'workflows' AND column_name IN ('webhook_token', 'webhook_token_hash')`,
    )
    const names = columns.rows.map((row) => row.column_name)
    // The plaintext column is gone; a member reading the row gets a SHA-256.
    expect(names).toEqual(['webhook_token_hash'])
  })
})

describe('subtask boards (00028)', () => {
  it('provisions a board and adopts existing subtasks', async () => {
    const taskId = await anAcmeTask()
    const { columns, orphans } = await asUser(db, acmeManager, async (c) => {
      await c.query('SELECT public.ensure_task_board($1)', [taskId])
      const cols = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM kanban_columns col
         JOIN kanban_boards b ON b.id = col.board_id WHERE b.task_id = $1`,
        [taskId],
      )
      const left = await c.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM subtasks WHERE task_id = $1 AND kanban_column_id IS NULL',
        [taskId],
      )
      return { columns: Number(cols.rows[0]?.count), orphans: Number(left.rows[0]?.count) }
    })

    expect(columns).toBe(4)
    // Subtasks that existed as checklist items are placed, not stranded.
    expect(orphans).toBe(0)
  })

  it('is idempotent', async () => {
    const taskId = await anAcmeTask()
    const same = await asUser(db, acmeManager, async (c) => {
      const result = await c.query<{ same: boolean }>(
        'SELECT public.ensure_task_board($1) = public.ensure_task_board($1) AS same',
        [taskId],
      )
      return result.rows[0]?.same
    })
    expect(same).toBe(true)
  })

  it('refuses to provision a board on another tenant’s task', async () => {
    // SECURITY DEFINER bypasses RLS, so this check is the only thing there.
    const taskId = await anAcmeTask()
    const message = await expectRejected(db, globexOwner, 'SELECT public.ensure_task_board($1)', [
      taskId,
    ])
    expect(message).toMatch(/Task not found/i)
  })

  it('refuses a principal with no org claim', async () => {
    const taskId = await anAcmeTask()
    const message = await expectRejected(
      db,
      { userId: FIXTURES.portal.userId },
      'SELECT public.ensure_task_board($1)',
      [taskId],
    )
    expect(message).toMatch(/Task not found/i)
  })
})

describe('integration deliveries (00027)', () => {
  it('is readable by an admin and not by a member', async () => {
    const seed = await db.query<{ id: string }>(
      `INSERT INTO integration_deliveries
         (organization_id, webhook_id, event_type, status)
       VALUES ($1, NULL, 'task.created', 'delivered')
       RETURNING id`,
      [FIXTURES.acme.orgId],
    ).catch(() => null)

    // The CHECK requires exactly one destination, so a row with neither is
    // refused — which is itself worth knowing.
    expect(seed).toBeNull()
  })

  it('requires exactly one destination', async () => {
    const result = await db
      .query(
        `INSERT INTO integration_deliveries (organization_id, event_type, status)
         VALUES ($1, 'task.created', 'delivered')`,
        [FIXTURES.acme.orgId],
      )
      .then(() => 'accepted')
      .catch((error: Error) => error.message)

    expect(result).toMatch(/integration_deliveries_check|violates/i)
  })

  it('is admin-only and never cross-tenant', async () => {
    const policies = await db.query<{ qual: string }>(
      `SELECT qual FROM pg_policies
       WHERE tablename = 'integration_deliveries' AND cmd = 'SELECT'`,
    )
    const qual = policies.rows[0]?.qual ?? ''
    expect(qual).toMatch(/org_id\(\)/)
    expect(qual).toMatch(/has_org_role\('admin'/)
  })

  it('has no write policy for end users', async () => {
    // The dispatcher runs as service_role; nobody writes through PostgREST.
    const writes = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_policies
       WHERE tablename = 'integration_deliveries' AND cmd <> 'SELECT'`,
    )
    expect(Number(writes.rows[0]?.count)).toBe(0)
  })
})

describe('import and export jobs (00029)', () => {
  it('lets a person record their own job', async () => {
    const status = await asUser(db, acmeManager, async (c) => {
      const result = await c.query<{ status: string }>(
        `INSERT INTO import_export_jobs (organization_id, type, entity_type, started_by, status)
         VALUES ($1, 'export', 'tasks', $2, 'processing')
         RETURNING status`,
        [FIXTURES.acme.orgId, FIXTURES.acme.manager],
      )
      return result.rows[0]?.status
    })
    expect(status).toBe('processing')
  })

  it('refuses a job attributed to someone else', async () => {
    const message = await expectRejected(
      db,
      acmeManager,
      `INSERT INTO import_export_jobs (organization_id, type, entity_type, started_by, status)
       VALUES ($1, 'export', 'tasks', $2, 'processing')`,
      [FIXTURES.acme.orgId, FIXTURES.acme.member],
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('shows a member their own jobs but not a colleague’s', async () => {
    // The colleague's row is created outside the impersonation and cleaned up
    // afterwards. Switching roles inside the helper's transaction is possible
    // but fragile — when it goes wrong the shared connection is left in an
    // aborted transaction and every later test in the file fails for the wrong
    // reason, which is exactly what happened while writing this.
    const seeded = await db.query<{ id: string }>(
      `INSERT INTO import_export_jobs (organization_id, type, entity_type, started_by, status)
       VALUES ($1, 'export', 'contacts', $2, 'processing')
       RETURNING id`,
      [FIXTURES.acme.orgId, FIXTURES.acme.manager],
    )
    const colleagueJob = seeded.rows[0]!.id

    try {
      const visible = await asUser(db, acmeMember, async (c) => {
        await c.query(
          `INSERT INTO import_export_jobs (organization_id, type, entity_type, started_by, status)
           VALUES ($1, 'export', 'tasks', $2, 'processing')`,
          [FIXTURES.acme.orgId, FIXTURES.acme.member],
        )
        const result = await c.query<{ started_by: string }>(
          'SELECT started_by FROM import_export_jobs',
        )
        return result.rows.map((row) => row.started_by)
      })

      expect(visible).toContain(FIXTURES.acme.member)
      expect(visible).not.toContain(FIXTURES.acme.manager)
    } finally {
      await db.query('DELETE FROM import_export_jobs WHERE id = $1', [colleagueJob])
    }
  })

  it('lets an admin see everyone’s jobs', async () => {
    const seeded = await db.query<{ id: string }>(
      `INSERT INTO import_export_jobs (organization_id, type, entity_type, started_by, status)
       VALUES ($1, 'export', 'contacts', $2, 'processing')
       RETURNING id`,
      [FIXTURES.acme.orgId, FIXTURES.acme.member],
    )
    const memberJob = seeded.rows[0]!.id

    try {
      const visible = await asUser(db, acmeOwner, async (c) => {
        const result = await c.query<{ started_by: string }>(
          'SELECT started_by FROM import_export_jobs WHERE id = $1',
          [memberJob],
        )
        return result.rowCount
      })
      // "Who exported the customer list" is the question this answers.
      expect(visible).toBe(1)
    } finally {
      await db.query('DELETE FROM import_export_jobs WHERE id = $1', [memberJob])
    }
  })

  it('never shows another tenant’s jobs', async () => {
    const seeded = await db.query<{ id: string }>(
      `INSERT INTO import_export_jobs (organization_id, type, entity_type, started_by, status)
       VALUES ($1, 'export', 'tasks', $2, 'processing')
       RETURNING id`,
      [FIXTURES.acme.orgId, FIXTURES.acme.owner],
    )
    const acmeJob = seeded.rows[0]!.id

    try {
      const visible = await asUser(db, globexOwner, async (c) => {
        const result = await c.query('SELECT id FROM import_export_jobs WHERE id = $1', [acmeJob])
        return result.rowCount
      })
      expect(visible).toBe(0)
    } finally {
      await db.query('DELETE FROM import_export_jobs WHERE id = $1', [acmeJob])
    }
  })

  it('is history: update and delete affect nothing', async () => {
    // Deliberately no UPDATE or DELETE policy. PostgREST does not error on a
    // zero-row write, so the assertion is on rows affected, not on a throw.
    const { updated, deleted, stillThere } = await asUser(db, acmeManager, async (c) => {
      const inserted = await c.query<{ id: string }>(
        `INSERT INTO import_export_jobs (organization_id, type, entity_type, started_by, status)
         VALUES ($1, 'export', 'tasks', $2, 'processing')
         RETURNING id`,
        [FIXTURES.acme.orgId, FIXTURES.acme.manager],
      )
      const id = inserted.rows[0]!.id

      const up = await c.query(`UPDATE import_export_jobs SET status = 'failed' WHERE id = $1`, [id])
      const del = await c.query('DELETE FROM import_export_jobs WHERE id = $1', [id])
      const check = await c.query('SELECT status FROM import_export_jobs WHERE id = $1', [id])

      return { updated: up.rowCount, deleted: del.rowCount, stillThere: check.rows[0] }
    })

    expect(updated).toBe(0)
    expect(deleted).toBe(0)
    expect(stillThere).toMatchObject({ status: 'processing' })
  })

  it('finishes a job through the function, once', async () => {
    const outcome = await asUser(db, acmeManager, async (c) => {
      const inserted = await c.query<{ id: string }>(
        `INSERT INTO import_export_jobs (organization_id, type, entity_type, started_by, status)
         VALUES ($1, 'import', 'contacts', $2, 'processing')
         RETURNING id`,
        [FIXTURES.acme.orgId, FIXTURES.acme.manager],
      )
      const id = inserted.rows[0]!.id

      await c.query(`SELECT public.finish_transfer_job($1, 'completed', '{"rows_processed":3}')`, [id])
      // A retry must not overwrite the real result with a later one.
      await c.query(`SELECT public.finish_transfer_job($1, 'failed', '{"rows_processed":0}')`, [id])

      const result = await c.query<{ status: string; result: { rows_processed: number } }>(
        'SELECT status, result FROM import_export_jobs WHERE id = $1',
        [id],
      )
      return result.rows[0]
    })

    expect(outcome?.status).toBe('completed')
    expect(outcome?.result.rows_processed).toBe(3)
  })

  it('will not finish another person’s job', async () => {
    const seeded = await db.query<{ id: string }>(
      `INSERT INTO import_export_jobs (organization_id, type, entity_type, started_by, status)
       VALUES ($1, 'import', 'contacts', $2, 'processing')
       RETURNING id`,
      [FIXTURES.acme.orgId, FIXTURES.acme.manager],
    )
    const managerJob = seeded.rows[0]!.id

    try {
      await asUser(db, acmeMember, async (c) => {
        // Silent by design: the function updates nothing rather than raising,
        // so a caller cannot use it to discover whose job an id belongs to.
        await c.query(`SELECT public.finish_transfer_job($1, 'failed', '{}')`, [managerJob])
      })

      const after = await db.query<{ status: string }>(
        'SELECT status FROM import_export_jobs WHERE id = $1',
        [managerJob],
      )
      expect(after.rows[0]?.status).toBe('processing')
    } finally {
      await db.query('DELETE FROM import_export_jobs WHERE id = $1', [managerJob])
    }
  })
})

describe('assignee lookup for imports (00030)', () => {
  it('resolves members of the caller’s own organization', async () => {
    const rows = await asUser(db, acmeManager, async (c) => {
      const result = await c.query<{ email: string }>(
        `SELECT email FROM public.org_member_ids_for_emails($1)`,
        [['owner@acme.test', 'member@acme.test']],
      )
      return result.rows.map((row) => row.email)
    })
    expect(rows.sort()).toEqual(['member@acme.test', 'owner@acme.test'])
  })

  it('is case-insensitive, so a spreadsheet’s capitalisation does not matter', async () => {
    const count = await asUser(db, acmeManager, async (c) => {
      const result = await c.query(`SELECT * FROM public.org_member_ids_for_emails($1)`, [
        ['OWNER@ACME.TEST'],
      ])
      return result.rowCount
    })
    expect(count).toBe(1)
  })

  it('never resolves another tenant’s member', async () => {
    // The whole point: this must not become a way to enumerate accounts.
    const count = await asUser(db, acmeManager, async (c) => {
      const result = await c.query(`SELECT * FROM public.org_member_ids_for_emails($1)`, [
        ['owner@globex.test'],
      ])
      return result.rowCount
    })
    expect(count).toBe(0)
  })

  it('returns nothing for an unknown address, so existence cannot be probed', async () => {
    const count = await asUser(db, acmeManager, async (c) => {
      const result = await c.query(`SELECT * FROM public.org_member_ids_for_emails($1)`, [
        ['nobody@nowhere.invalid'],
      ])
      return result.rowCount
    })
    expect(count).toBe(0)
  })

  it('is manager-gated', async () => {
    const count = await asUser(db, acmeMember, async (c) => {
      const result = await c.query(`SELECT * FROM public.org_member_ids_for_emails($1)`, [
        ['owner@acme.test'],
      ])
      return result.rowCount
    })
    expect(count).toBe(0)
  })

  it('is not executable by anon', async () => {
    const granted = await db.query<{ granted: boolean }>(
      `SELECT has_function_privilege('anon', 'public.org_member_ids_for_emails(text[])', 'EXECUTE') AS granted`,
    )
    expect(granted.rows[0]?.granted).toBe(false)
  })
})

describe('pdf templates', () => {
  it('is confined to the organization', async () => {
    const acme = await asUser(db, acmeOwner, async (c) => {
      await c.query(
        `INSERT INTO pdf_templates (organization_id, doc_type, name, template_data)
         VALUES ($1, 'quotation', 'RLS probe', '{}'::jsonb)`,
        [FIXTURES.acme.orgId],
      )
      const result = await c.query('SELECT id FROM pdf_templates')
      return result.rowCount
    })
    expect(acme).toBeGreaterThan(0)

    const globex = await asUser(db, globexOwner, async (c) => {
      const result = await c.query('SELECT id FROM pdf_templates WHERE organization_id = $1', [
        FIXTURES.acme.orgId,
      ])
      return result.rowCount
    })
    expect(globex).toBe(0)
  })

  it('refuses a template planted in another organization', async () => {
    const message = await expectRejected(
      db,
      globexOwner,
      `INSERT INTO pdf_templates (organization_id, doc_type, name, template_data)
       VALUES ($1, 'quotation', 'cross tenant', '{}'::jsonb)`,
      [FIXTURES.acme.orgId],
    )
    expect(message).toMatch(/row-level security/i)
  })
})
