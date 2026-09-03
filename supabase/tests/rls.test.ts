import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURES, asUser, connect, countVisible, expectRejected } from './helpers'

/**
 * RLS isolation tests (claude.md §14).
 *
 * The contract under test: a user in one organization can neither read nor
 * write another organization's data, and role boundaries hold within an org.
 * These run in CI as `pnpm test:rls` and are the gate on every PR.
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
// A portal user holds no org_id claim at all.
const portalUser = { userId: FIXTURES.portal.userId } as const

describe('tenant isolation', () => {
  const tenantScopedTables = [
    'projects',
    'tasks',
    'subtasks',
    'workspaces',
    'labels',
    'kanban_boards',
    'kanban_columns',
  ]

  it.each(tenantScopedTables)('%s never leaks across organizations', async (table) => {
    const acmeCount = await countVisible(db, acmeOwner, table)
    const globexCount = await countVisible(db, globexOwner, table)

    // Each tenant sees rows, and neither sees the union of both.
    const totalResult = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`,
    )
    const total = Number.parseInt(totalResult.rows[0]?.count ?? '0', 10)

    expect(acmeCount).toBeGreaterThan(0)
    expect(globexCount).toBeGreaterThan(0)
    expect(acmeCount + globexCount).toBeLessThanOrEqual(total)
    expect(acmeCount).toBeLessThan(total)
    expect(globexCount).toBeLessThan(total)
  })

  it('a direct fetch by id of another tenant row returns nothing', async () => {
    const rows = await asUser(db, acmeOwner, async (c) => {
      const result = await c.query('SELECT id FROM projects WHERE id = $1', [
        FIXTURES.globex.projectId,
      ])
      return result.rowCount
    })
    expect(rows).toBe(0)
  })

  it('rejects an insert into another tenant', async () => {
    const message = await expectRejected(
      db,
      acmeOwner,
      `INSERT INTO tasks (organization_id, project_id, title) VALUES ($1, $2, 'injected')`,
      [FIXTURES.globex.orgId, FIXTURES.globex.projectId],
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('rejects a forged organization_id on an otherwise valid row', async () => {
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO tasks (organization_id, project_id, title) VALUES ($1, $2, 'forged')`,
      [FIXTURES.globex.orgId, FIXTURES.acme.projectId],
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('an update cannot move a row into another tenant', async () => {
    const message = await expectRejected(
      db,
      acmeOwner,
      `UPDATE tasks SET organization_id = $1 WHERE project_id = $2`,
      [FIXTURES.globex.orgId, FIXTURES.acme.projectId],
    )
    expect(message).toMatch(/row-level security/i)
  })
})

describe('role boundaries within an organization', () => {
  it('members cannot read commercial documents', async () => {
    expect(await countVisible(db, acmeMember, 'commercial_documents')).toBe(0)
  })

  it('members cannot read audit logs', async () => {
    expect(await countVisible(db, acmeMember, 'audit_logs')).toBe(0)
  })

  it('members cannot read the raw event stream', async () => {
    expect(await countVisible(db, acmeMember, 'events')).toBe(0)
  })

  it('admins can read the event stream', async () => {
    expect(await countVisible(db, acmeOwner, 'events')).toBeGreaterThan(0)
  })

  it('members can create a task in a project they belong to', async () => {
    const taskNumber = await asUser(db, acmeMember, async (c) => {
      const result = await c.query<{ task_number: number }>(
        `INSERT INTO tasks (organization_id, project_id, title)
         VALUES ($1, $2, 'member task') RETURNING task_number`,
        [FIXTURES.acme.orgId, FIXTURES.acme.projectId],
      )
      return result.rows[0]?.task_number
    })
    expect(taskNumber).toBeGreaterThan(0)
  })

  it('members cannot delete tasks', async () => {
    const deleted = await asUser(db, acmeMember, async (c) => {
      const result = await c.query('DELETE FROM tasks WHERE project_id = $1', [
        FIXTURES.acme.projectId,
      ])
      return result.rowCount
    })
    expect(deleted).toBe(0)
  })

  it('managers can delete tasks', async () => {
    const deleted = await asUser(db, acmeManager, async (c) => {
      const result = await c.query('DELETE FROM tasks WHERE project_id = $1', [
        FIXTURES.acme.projectId,
      ])
      return result.rowCount
    })
    expect(deleted).toBeGreaterThan(0)
  })

  it('members cannot create a workspace', async () => {
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, 'Sneaky', 'sneaky')`,
      [FIXTURES.acme.orgId],
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('a member cannot promote themselves', async () => {
    const updated = await asUser(db, acmeMember, async (c) => {
      const result = await c.query(
        `UPDATE org_members SET role = 'owner' WHERE user_id = $1 AND organization_id = $2`,
        [FIXTURES.acme.member, FIXTURES.acme.orgId],
      )
      return result.rowCount
    })
    expect(updated).toBe(0)
  })
})

describe('portal user scoping (business rule 6)', () => {
  it('sees only projects explicitly shared with them', async () => {
    const names = await asUser(db, portalUser, async (c) => {
      const result = await c.query<{ id: string }>('SELECT id FROM projects')
      return result.rows.map((row) => row.id)
    })
    expect(names).toEqual([FIXTURES.acme.projectId])
  })

  it('does not inherit access to other projects in the same org', async () => {
    const visible = await asUser(db, portalUser, async (c) => {
      const result = await c.query('SELECT id FROM projects WHERE id = $1', [
        FIXTURES.acme.orgOnlyProjectId,
      ])
      return result.rowCount
    })
    expect(visible).toBe(0)
  })

  it('cannot see internal comments', async () => {
    // Seed an internal comment as a staff member, then read as the portal user.
    await db.query(
      `INSERT INTO comments (id, organization_id, task_id, author_id, body, is_internal)
       SELECT '99999999-9999-9999-9999-999999999999', $1, t.id, $2, '{"type":"doc"}'::jsonb, true
       FROM tasks t WHERE t.project_id = $3 LIMIT 1
       ON CONFLICT (id) DO NOTHING`,
      [FIXTURES.acme.orgId, FIXTURES.acme.owner, FIXTURES.acme.projectId],
    )

    const visible = await asUser(db, portalUser, async (c) => {
      const result = await c.query('SELECT id FROM comments WHERE is_internal = true')
      return result.rowCount
    })
    expect(visible).toBe(0)

    await db.query('DELETE FROM comments WHERE id = $1', [
      '99999999-9999-9999-9999-999999999999',
    ])
  })

  it('cannot read another tenant at all', async () => {
    expect(await countVisible(db, portalUser, 'tasks')).toBeGreaterThan(0)
    const globexVisible = await asUser(db, portalUser, async (c) => {
      const result = await c.query('SELECT id FROM projects WHERE organization_id = $1', [
        FIXTURES.globex.orgId,
      ])
      return result.rowCount
    })
    expect(globexVisible).toBe(0)
  })
})

describe('immutability and derived columns', () => {
  it('audit logs cannot be updated', async () => {
    await db.query(
      `INSERT INTO audit_logs (organization_id, action, resource_type)
       VALUES ($1, 'test.entry', 'test')`,
      [FIXTURES.acme.orgId],
    )
    await expect(
      db.query(`UPDATE audit_logs SET action = 'tampered' WHERE action = 'test.entry'`),
    ).rejects.toThrow(/append-only/i)
    await db.query('BEGIN')
    await db.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable')
    await db.query(`DELETE FROM audit_logs WHERE action = 'test.entry'`)
    await db.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable')
    await db.query('COMMIT')
  })

  it('task numbers are sequential per project and never reused', async () => {
    const result = await db.query<{ project_id: string; numbers: string }>(
      `SELECT project_id, string_agg(task_number::text, ',' ORDER BY task_number) AS numbers
       FROM tasks GROUP BY project_id`,
    )
    for (const row of result.rows) {
      const numbers = row.numbers.split(',').map(Number)
      expect(new Set(numbers).size).toBe(numbers.length)
      expect(numbers[0]).toBe(1)
    }
  })

  it('a client cannot rewrite a task number', async () => {
    // Targets one row so a unique-constraint violation cannot mask the real
    // reason for the rejection, which must be the missing column privilege.
    const message = await expectRejected(
      db,
      acmeOwner,
      `UPDATE tasks SET task_number = 9999
       WHERE id = (SELECT id FROM tasks WHERE project_id = $1 LIMIT 1)`,
      [FIXTURES.acme.projectId],
    )
    expect(message).toMatch(/permission denied for (column|table)/i)
  })

  it('OAuth tokens are unreadable by an end-user session', async () => {
    // A table-level SELECT grant would silently override a column-level revoke,
    // so this asserts the privilege itself rather than trusting the REVOKE.
    const result = await db.query<{ readable: boolean; writable: boolean }>(`
      SELECT has_column_privilege('authenticated','public.integrations','access_token','SELECT')
               AS readable,
             has_column_privilege('authenticated','public.integrations','access_token','UPDATE')
               AS writable
    `)
    expect(result.rows[0]?.readable).toBe(false)
    expect(result.rows[0]?.writable).toBe(false)
  })

  it('derived money columns are not client-writable', async () => {
    const result = await db.query<{ col: string }>(`
      SELECT unnest(ARRAY['subtotal','tax_total','discount_total','grand_total']) AS col
    `)
    for (const { col } of result.rows) {
      const check = await db.query<{ writable: boolean }>(
        `SELECT has_column_privilege('authenticated','public.commercial_documents',$1,'UPDATE') AS writable`,
        [col],
      )
      expect(check.rows[0]?.writable).toBe(false)
    }
  })
})

describe('every tenant table has RLS enabled', () => {
  it('leaves no table unprotected', async () => {
    const result = await db.query<{ tablename: string }>(`
      SELECT t.tablename
      FROM pg_tables t
      JOIN pg_class c ON c.relname = t.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE t.schemaname = 'public' AND NOT c.relrowsecurity
      ORDER BY 1
    `)
    expect(result.rows.map((row) => row.tablename)).toEqual([])
  })

  it('leaves no table with RLS on but zero policies', async () => {
    const result = await db.query<{ tablename: string }>(`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND c.relrowsecurity
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname
        )
      ORDER BY 1
    `)
    expect(result.rows.map((row) => row.tablename)).toEqual([])
  })
})
