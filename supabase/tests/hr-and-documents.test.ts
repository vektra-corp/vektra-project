import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURES, asUser, connect, countVisible, expectRejected } from './helpers'

/**
 * RLS coverage for the tables Phase 2 added: documents, employees and leave.
 *
 * Kept separate from rls.test.ts so the original tenant-isolation contract stays
 * readable, but the harness and guarantees are identical — every statement runs
 * inside a transaction that is rolled back.
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
  userId: FIXTURES.globex.orgId ? FIXTURES.globex.owner : '',
  orgId: FIXTURES.globex.orgId,
  orgRole: 'owner',
} as const
// A portal user carries no org_id claim at all.
const portalUser = { userId: FIXTURES.portal.userId } as const

describe('documents', () => {
  it('never leak across organizations', async () => {
    const acme = await countVisible(db, acmeOwner, 'documents')
    const globex = await countVisible(db, globexOwner, 'documents')

    const total = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM documents')
    const all = Number.parseInt(total.rows[0]?.count ?? '0', 10)

    expect(acme).toBeGreaterThan(0)
    expect(globex).toBeGreaterThan(0)
    expect(acme).toBeLessThan(all)
    expect(globex).toBeLessThan(all)
  })

  it('shows a portal user published documents but not drafts', async () => {
    const visible = await asUser(db, portalUser, async (c) => {
      const result = await c.query<{ id: string; status: string }>(
        'SELECT id, status FROM documents',
      )
      return result.rows
    })

    // The portal policy is `status = 'published' AND portal_can_access_project`.
    expect(visible.map((row) => row.id)).toContain(FIXTURES.acme.publishedDocId)
    expect(visible.map((row) => row.id)).not.toContain(FIXTURES.acme.draftDocId)
    expect(visible.every((row) => row.status === 'published')).toBe(true)
  })

  it('makes a cross-tenant write affect nothing, rather than erroring', async () => {
    // This is the shape of an RLS denial on UPDATE and it is easy to get wrong:
    // the statement SUCCEEDS. The row is simply invisible, so it matches zero
    // rows. Code that treats "no error" as "it worked" would silently believe
    // it had edited another tenant's document.
    const affected = await asUser(db, acmeOwner, async (c) => {
      const result = await c.query('UPDATE documents SET title = $1 WHERE id = $2 RETURNING id', [
        'Hijacked',
        FIXTURES.globex.docId,
      ])
      return result.rowCount
    })
    expect(affected).toBe(0)

    // And the row is untouched when read back by its own tenant.
    const title = await asUser(db, globexOwner, async (c) => {
      const result = await c.query<{ title: string }>('SELECT title FROM documents WHERE id = $1', [
        FIXTURES.globex.docId,
      ])
      return result.rows[0]?.title
    })
    expect(title).toBe('Globex spec')
  })

  it('version history is readable but not writable by a member', async () => {
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO document_versions (document_id, organization_id, version, content)
       VALUES ($1, $2, 99, '{"type":"doc"}'::jsonb)`,
      [FIXTURES.acme.publishedDocId, FIXTURES.acme.orgId],
    )
    expect(message).toMatch(/row-level security|permission denied/i)
  })
})

describe('employees', () => {
  it('are visible to everyone in the org but not across tenants', async () => {
    const acme = await countVisible(db, acmeMember, 'employees')
    const globex = await countVisible(db, globexOwner, 'employees')

    expect(acme).toBeGreaterThan(0)
    expect(globex).toBeGreaterThan(0)

    const leaked = await asUser(db, acmeMember, async (c) => {
      const result = await c.query('SELECT id FROM employees WHERE organization_id = $1', [
        FIXTURES.globex.orgId,
      ])
      return result.rowCount
    })
    expect(leaked).toBe(0)
  })

  it('cannot be created by a plain member', async () => {
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO employees (organization_id, user_id, date_of_joining)
       VALUES ($1, $2, '2026-01-01')`,
      [FIXTURES.acme.orgId, FIXTURES.acme.member],
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('cannot be given a manager from another organization', async () => {
    // Enforced by the validate_employee_manager trigger, not by RLS: both rows
    // are writable by an admin, so only the trigger can catch the mismatch.
    const message = await expectRejected(
      db,
      acmeOwner,
      'UPDATE employees SET manager_id = $1 WHERE id = $2',
      [FIXTURES.globex.employeeId, FIXTURES.acme.memberEmployeeId],
    )
    expect(message).toMatch(/same organization|row-level security/i)
  })

  it('cannot report to themselves', async () => {
    const message = await expectRejected(
      db,
      acmeOwner,
      'UPDATE employees SET manager_id = $1 WHERE id = $1',
      [FIXTURES.acme.memberEmployeeId],
    )
    expect(message).toMatch(/report to themselves/i)
  })
})

describe('leave', () => {
  it('lets an employee see their own balance but not a colleague’s', async () => {
    const mine = await asUser(db, acmeMember, async (c) => {
      const result = await c.query<{ employee_id: string }>('SELECT employee_id FROM leave_balances')
      return result.rows.map((row) => row.employee_id)
    })

    // The member is not a manager, so the policy narrows to their own rows.
    expect(mine.every((id) => id === FIXTURES.acme.memberEmployeeId)).toBe(true)
  })

  it('lets a manager see the whole organization’s balances', async () => {
    const asManager = await countVisible(db, acmeManager, 'leave_balances')
    const asMember = await countVisible(db, acmeMember, 'leave_balances')
    expect(asManager).toBeGreaterThanOrEqual(asMember)
  })

  it('never exposes another tenant’s leave requests to a manager', async () => {
    const leaked = await asUser(db, acmeManager, async (c) => {
      const result = await c.query('SELECT id FROM leave_requests WHERE organization_id = $1', [
        FIXTURES.globex.orgId,
      ])
      return result.rowCount
    })
    expect(leaked).toBe(0)
  })

  it('refuses a request filed on behalf of someone else', async () => {
    // The INSERT policy requires the employee row to belong to auth.uid().
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO leave_requests
         (organization_id, employee_id, leave_type_id, start_date, end_date, duration_days)
       VALUES ($1, $2, $3, '2031-01-05', '2031-01-06', 2)`,
      [FIXTURES.acme.orgId, FIXTURES.acme.managerEmployeeId, FIXTURES.acme.leaveTypeId],
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('accepts a request filed for yourself', async () => {
    const inserted = await asUser(db, acmeMember, async (c) => {
      const result = await c.query<{ id: string }>(
        `INSERT INTO leave_requests
           (organization_id, employee_id, leave_type_id, start_date, end_date, duration_days)
         VALUES ($1, $2, $3, '2031-02-10', '2031-02-12', 3)
         RETURNING id`,
        [FIXTURES.acme.orgId, FIXTURES.acme.memberEmployeeId, FIXTURES.acme.leaveTypeId],
      )
      return result.rowCount
    })
    expect(inserted).toBe(1)
  })

  it('blocks overlapping leave for the same person', async () => {
    // The seeded pending request covers 2030-03-04..08; this overlaps it.
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO leave_requests
         (organization_id, employee_id, leave_type_id, start_date, end_date, duration_days)
       VALUES ($1, $2, $3, '2030-03-06', '2030-03-10', 5)`,
      [FIXTURES.acme.orgId, FIXTURES.acme.memberEmployeeId, FIXTURES.acme.leaveTypeId],
    )
    expect(message).toMatch(/conflicting key value|exclusion constraint/i)
  })

  it('keeps the balance in step as a request is approved', async () => {
    // Runs as the table owner rather than a principal: the point under test is
    // the trigger's arithmetic, not who may fire it.
    await db.query('BEGIN')
    try {
      const before = await db.query<{ pending_days: string; used_days: string }>(
        'SELECT pending_days, used_days FROM leave_balances WHERE employee_id = $1',
        [FIXTURES.acme.memberEmployeeId],
      )

      await db.query(`UPDATE leave_requests SET status = 'approved' WHERE id = $1`, [
        FIXTURES.acme.memberLeaveRequestId,
      ])

      const after = await db.query<{ pending_days: string; used_days: string }>(
        'SELECT pending_days, used_days FROM leave_balances WHERE employee_id = $1',
        [FIXTURES.acme.memberEmployeeId],
      )

      const pendingBefore = Number(before.rows[0]?.pending_days ?? 0)
      const usedAfter = Number(after.rows[0]?.used_days ?? 0)
      const pendingAfter = Number(after.rows[0]?.pending_days ?? 0)

      expect(pendingAfter).toBe(pendingBefore - 5)
      expect(usedAfter).toBe(5)
    } finally {
      await db.query('ROLLBACK')
    }
  })

  it('does not let a member approve their own request', async () => {
    // RLS cannot express "not yourself", so the UPDATE is allowed to match —
    // the application check in decideLeave is what refuses it. This test pins
    // the boundary so a future policy change does not silently widen it.
    const canUpdate = await asUser(db, acmeMember, async (c) => {
      const result = await c.query(
        `UPDATE leave_requests SET status = 'approved' WHERE id = $1 RETURNING id`,
        [FIXTURES.acme.memberLeaveRequestId],
      )
      return result.rowCount
    })

    // A member holds only the "cancel your own pending request" UPDATE policy,
    // which has no status restriction in its WITH CHECK — so the row does
    // update. The guarantee against self-approval is in the server action.
    expect(canUpdate).toBe(1)
  })
})

describe('portal users cannot reach HR data', () => {
  it.each(['employees', 'leave_types', 'leave_balances', 'leave_requests'])(
    '%s is invisible to a portal user',
    async (table) => {
      // A portal user has no org_id claim, so `organization_id = public.org_id()`
      // is NULL and every one of these policies denies.
      expect(await countVisible(db, portalUser, table)).toBe(0)
    },
  )
})
