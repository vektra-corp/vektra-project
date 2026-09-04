import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURES, asUser, connect, countVisible, expectRejected } from './helpers'

/**
 * RLS coverage for migrations 00017–00022: dashboards, timesheets, automation
 * and reporting.
 *
 * Two of these are unusual and get extra attention:
 *   - `revenue_summary` is a materialized view, which cannot carry RLS at all.
 *     The only thing standing between one tenant and another's revenue is the
 *     `revenue_for_org()` function, so it is tested directly.
 *   - 00021 repointed foreign keys from auth.users to profiles. That is not a
 *     policy, but getting it wrong breaks queries only at run time, so it has a
 *     regression test here rather than nowhere.
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
const portalUser = { userId: FIXTURES.portal.userId } as const

describe('time entries (00018)', () => {
  it('shows a member only their own time', async () => {
    const ids = await asUser(db, acmeMember, async (c) => {
      const result = await c.query<{ user_id: string }>('SELECT user_id FROM time_entries')
      return result.rows.map((row) => row.user_id)
    })

    expect(ids.length).toBeGreaterThan(0)
    // Personal data about how someone spends their day: a peer never sees it.
    expect(ids.every((id) => id === FIXTURES.acme.member)).toBe(true)
  })

  it('shows a manager the whole organization', async () => {
    const asManager = await countVisible(db, acmeManager, 'time_entries')
    const asMember = await countVisible(db, acmeMember, 'time_entries')
    expect(asManager).toBeGreaterThan(asMember)
  })

  it('never crosses tenants, even for a manager', async () => {
    const leaked = await asUser(db, acmeManager, async (c) => {
      const result = await c.query('SELECT id FROM time_entries WHERE organization_id = $1', [
        FIXTURES.globex.orgId,
      ])
      return result.rowCount
    })
    expect(leaked).toBe(0)
  })

  it('refuses time logged on behalf of someone else', async () => {
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO time_entries (organization_id, user_id, project_id, start_time, duration_minutes)
       VALUES ($1, $2, $3, '2030-07-01T09:00:00Z', 60)`,
      [FIXTURES.acme.orgId, FIXTURES.acme.manager, FIXTURES.acme.projectId],
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('refuses editing a colleague’s entry', async () => {
    // The row is invisible to this member, so the UPDATE matches nothing. That
    // is an RLS denial on UPDATE: it succeeds and affects zero rows.
    const affected = await asUser(db, acmeMember, async (c) => {
      const result = await c.query(
        'UPDATE time_entries SET description = $1 WHERE id = $2 RETURNING id',
        ['Tampered', FIXTURES.acme.managerTimeEntryId],
      )
      return result.rowCount
    })
    expect(affected).toBe(0)
  })

  it('enforces one running timer per person at the database level', async () => {
    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO time_entries (organization_id, user_id, project_id, start_time, is_running)
       SELECT $1, $2, $3, now(), true
       FROM generate_series(1, 2)`,
      [FIXTURES.acme.orgId, FIXTURES.acme.member, FIXTURES.acme.projectId],
    )
    expect(message).toMatch(/duplicate key|unique constraint/i)
  })
})

describe('timesheet periods (00018)', () => {
  it('is visible to its owner and to managers, not to peers', async () => {
    const mine = await asUser(db, acmeMember, async (c) => {
      const result = await c.query<{ user_id: string }>('SELECT user_id FROM timesheet_periods')
      return result.rows.map((row) => row.user_id)
    })
    expect(mine.every((id) => id === FIXTURES.acme.member)).toBe(true)

    expect(await countVisible(db, acmeManager, 'timesheet_periods')).toBeGreaterThanOrEqual(
      mine.length,
    )
  })

  it('does not expose another tenant’s timesheets', async () => {
    const leaked = await asUser(db, acmeManager, async (c) => {
      const result = await c.query('SELECT id FROM timesheet_periods WHERE organization_id = $1', [
        FIXTURES.globex.orgId,
      ])
      return result.rowCount
    })
    expect(leaked).toBe(0)
  })
})

describe('saved reports (00020)', () => {
  it('shows the owner both their private and shared reports', async () => {
    const ids = await asUser(db, acmeManager, async (c) => {
      const result = await c.query<{ id: string }>('SELECT id FROM saved_reports')
      return result.rows.map((row) => row.id)
    })
    expect(ids).toContain(FIXTURES.acme.privateReportId)
    expect(ids).toContain(FIXTURES.acme.sharedReportId)
  })

  it('shows another member only the shared one', async () => {
    const ids = await asUser(db, acmeOwner, async (c) => {
      const result = await c.query<{ id: string }>('SELECT id FROM saved_reports')
      return result.rows.map((row) => row.id)
    })
    expect(ids).toContain(FIXTURES.acme.sharedReportId)
    expect(ids).not.toContain(FIXTURES.acme.privateReportId)
  })

  it('does not let a reader edit someone else’s shared report', async () => {
    // Sharing grants visibility, not ownership.
    const affected = await asUser(db, acmeOwner, async (c) => {
      const result = await c.query(
        'UPDATE saved_reports SET name = $1 WHERE id = $2 RETURNING id',
        ['Hijacked', FIXTURES.acme.sharedReportId],
      )
      return result.rowCount
    })
    expect(affected).toBe(0)
  })
})

describe('dashboards (00017)', () => {
  it('is private to its owner', async () => {
    const ids = await asUser(db, acmeManager, async (c) => {
      const result = await c.query<{ user_id: string }>('SELECT user_id FROM dashboard_configs')
      return result.rows.map((row) => row.user_id)
    })
    // A dashboard has no sharing policy at all — not even for an owner.
    expect(ids.every((id) => id === FIXTURES.acme.manager)).toBe(true)
  })

  it('is invisible to an org owner who does not own it', async () => {
    const visible = await asUser(db, acmeOwner, async (c) => {
      const result = await c.query('SELECT id FROM dashboard_configs WHERE id = $1', [
        FIXTURES.acme.managerDashboardId,
      ])
      return result.rowCount
    })
    expect(visible).toBe(0)
  })
})

describe('auto-assignment rules (00020)', () => {
  it('is readable org-wide but writable only by managers', async () => {
    expect(await countVisible(db, acmeMember, 'auto_assignment_rules')).toBeGreaterThan(0)

    const message = await expectRejected(
      db,
      acmeMember,
      `INSERT INTO auto_assignment_rules (organization_id, name, assignee_pool)
       VALUES ($1, 'Mine', ARRAY[$2::uuid])`,
      [FIXTURES.acme.orgId, FIXTURES.acme.member],
    )
    expect(message).toMatch(/row-level security/i)
  })
})

describe('revenue reporting (00020)', () => {
  it('returns only the caller’s own organization', async () => {
    // revenue_summary is a materialized view and cannot carry RLS. This
    // function is the entire boundary, so it is tested directly.
    const acme = await asUser(db, acmeManager, async (c) => {
      const result = await c.query<{ invoiced_revenue: string }>(
        'SELECT invoiced_revenue FROM public.revenue_for_org(240)',
      )
      return result.rows.map((row) => Number(row.invoiced_revenue))
    })

    const globex = await asUser(db, globexOwner, async (c) => {
      const result = await c.query<{ invoiced_revenue: string }>(
        'SELECT invoiced_revenue FROM public.revenue_for_org(240)',
      )
      return result.rows.map((row) => Number(row.invoiced_revenue))
    })

    // The two tenants' seeded invoices are 1000 and 7777; neither may see the
    // other's figure.
    expect(acme).toContain(1000)
    expect(acme).not.toContain(7777)
    expect(globex).toContain(7777)
    expect(globex).not.toContain(1000)
  })

  it('returns nothing to a principal with no org claim', async () => {
    const rows = await asUser(db, portalUser, async (c) => {
      const result = await c.query('SELECT * FROM public.revenue_for_org(240)')
      return result.rowCount
    })
    // org_id() is NULL for a portal user, so the filter matches nothing.
    expect(rows).toBe(0)
  })

  it('does not expose the materialized view itself to an end user', async () => {
    const message = await expectRejected(db, acmeManager, 'SELECT * FROM revenue_summary')
    expect(message).toMatch(/permission denied/i)
  })
})

describe('profile relationships (00021)', () => {
  it('points every embedded user column at profiles, not auth.users', async () => {
    // Getting this wrong breaks a PostgREST embed at RUN time while typecheck
    // still passes — exactly the failure this migration was written to fix.
    const embedded = [
      ['employees', 'user_id'],
      ['time_entries', 'user_id'],
      ['timesheet_periods', 'user_id'],
      ['timesheet_periods', 'approved_by'],
      ['leave_requests', 'approved_by'],
      ['saved_reports', 'created_by'],
      ['dashboard_configs', 'user_id'],
      ['commercial_documents', 'created_by'],
      ['contacts', 'created_by'],
      ['document_versions', 'edited_by'],
    ] as const

    const { rows } = await db.query<{ tbl: string; col: string; refs: string }>(
      `SELECT t.relname AS tbl, a.attname AS col, rn.nspname || '.' || rel.relname AS refs
       FROM pg_constraint c
       JOIN pg_class t       ON t.oid = c.conrelid
       JOIN pg_namespace tn  ON tn.oid = t.relnamespace
       JOIN pg_class rel     ON rel.oid = c.confrelid
       JOIN pg_namespace rn  ON rn.oid = rel.relnamespace
       JOIN unnest(c.conkey) AS k(attnum) ON true
       JOIN pg_attribute a   ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE c.contype = 'f' AND tn.nspname = 'public'`,
    )

    const target = new Map(rows.map((row) => [`${row.tbl}.${row.col}`, row.refs]))

    for (const [table, column] of embedded) {
      expect(target.get(`${table}.${column}`), `${table}.${column}`).toBe('public.profiles')
    }
  })

  it('keeps profiles itself anchored to auth.users', async () => {
    // The one key that must NOT be repointed — it is the link to auth.
    const { rows } = await db.query<{ refs: string }>(
      `SELECT rn.nspname || '.' || rel.relname AS refs
       FROM pg_constraint c
       JOIN pg_class t      ON t.oid = c.conrelid
       JOIN pg_class rel    ON rel.oid = c.confrelid
       JOIN pg_namespace rn ON rn.oid = rel.relnamespace
       WHERE c.contype = 'f' AND t.relname = 'profiles'`,
    )
    expect(rows.map((row) => row.refs)).toContain('auth.users')
  })
})
