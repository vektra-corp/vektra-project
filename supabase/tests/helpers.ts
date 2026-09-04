import { Client } from 'pg'

/**
 * Test harness for RLS policies.
 *
 * These tests connect to Postgres directly rather than through PostgREST, and
 * impersonate a user by assuming the `authenticated` role and setting the
 * `request.jwt.claims` GUC — exactly what Supabase's API layer does per request.
 * That means the policies under test are the same ones a real request hits.
 */

export const DATABASE_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * Guard against running a destructive suite on the wrong database.
 *
 * These tests DELETE tasks and INSERT comments. Against a local throwaway that
 * is fine; against a shared cloud project it is data loss. Since moving to a
 * hosted database, "the connection string is right there in my shell" is no
 * longer a safe assumption, so anything that is not obviously local has to be
 * opted into explicitly.
 */
function assertSafeToMutate(url: string): void {
  const isLocal =
    url.includes('127.0.0.1') || url.includes('localhost') || url.includes('@db:')

  if (isLocal) return

  if (process.env.ALLOW_DESTRUCTIVE_TESTS !== 'true') {
    throw new Error(
      [
        'Refusing to run destructive RLS tests against a non-local database.',
        `  target: ${url.replace(/:[^:@/]+@/, ':***@')}`,
        '',
        'These tests delete and insert rows. If this really is a disposable',
        'development project, re-run with ALLOW_DESTRUCTIVE_TESTS=true.',
        'Never set that against production.',
      ].join('\n'),
    )
  }
}

/** Seeded fixture ids from supabase/seed.sql. */
export const FIXTURES = {
  acme: {
    orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    workspaceId: 'a1a1a1a1-0000-0000-0000-000000000001',
    projectId: 'a2a2a2a2-0000-0000-0000-000000000001',
    orgOnlyProjectId: 'a2a2a2a2-0000-0000-0000-000000000002',
    owner: '11111111-1111-1111-1111-111111111111',
    manager: '22222222-2222-2222-2222-222222222222',
    member: '33333333-3333-3333-3333-333333333333',
    publishedDocId: 'a5a5a5a5-0000-0000-0000-000000000001',
    draftDocId: 'a5a5a5a5-0000-0000-0000-000000000002',
    // The manager's own employee record, and the member's.
    managerEmployeeId: 'a6a6a6a6-0000-0000-0000-000000000001',
    memberEmployeeId: 'a6a6a6a6-0000-0000-0000-000000000002',
    leaveTypeId: 'a7a7a7a7-0000-0000-0000-000000000001',
    memberLeaveRequestId: 'a8a8a8a8-0000-0000-0000-000000000001',
  },
  globex: {
    orgId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    projectId: 'b2b2b2b2-0000-0000-0000-000000000001',
    owner: '44444444-4444-4444-4444-444444444444',
    docId: 'b5b5b5b5-0000-0000-0000-000000000001',
    employeeId: 'b6b6b6b6-0000-0000-0000-000000000001',
    leaveTypeId: 'b7b7b7b7-0000-0000-0000-000000000001',
    leaveRequestId: 'b8b8b8b8-0000-0000-0000-000000000001',
  },
  portal: {
    userId: '55555555-5555-5555-5555-555555555555',
    portalUserId: 'a4a4a4a4-0000-0000-0000-000000000001',
  },
} as const

export interface Principal {
  userId: string
  orgId?: string
  orgRole?: 'owner' | 'admin' | 'manager' | 'member'
}

export async function connect(): Promise<Client> {
  assertSafeToMutate(DATABASE_URL)
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  return client
}

/**
 * Run `fn` inside a transaction that is always rolled back, with the connection
 * impersonating `principal`. Nothing a test does can leak into another test.
 */
export async function asUser<T>(
  client: Client,
  principal: Principal,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const claims: Record<string, string> = { sub: principal.userId, role: 'authenticated' }
  if (principal.orgId) claims.org_id = principal.orgId
  if (principal.orgRole) claims.org_role = principal.orgRole

  await client.query('BEGIN')
  try {
    await client.query('SET LOCAL ROLE authenticated')
    await client.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify(claims),
    ])
    return await fn(client)
  } finally {
    await client.query('ROLLBACK')
  }
}

/** Row count a principal can see in a table. */
export async function countVisible(
  client: Client,
  principal: Principal,
  table: string,
): Promise<number> {
  return asUser(client, principal, async (c) => {
    const result = await c.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`)
    return Number.parseInt(result.rows[0]?.count ?? '0', 10)
  })
}

/** Assert that a statement is rejected, and return the Postgres error message. */
export async function expectRejected(
  client: Client,
  principal: Principal,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  return asUser(client, principal, async (c) => {
    try {
      await c.query(sql, params)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    throw new Error(`Expected the statement to be rejected, but it succeeded: ${sql}`)
  })
}
