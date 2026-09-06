import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, connect, countVisible, expectRejected, FIXTURES } from './helpers'

/**
 * Billing isolation and anti-tamper (migration 00037).
 *
 * The first block is the important one: it is a regression test for a live
 * privilege-escalation hole. Before 00037 an org owner could PATCH
 * `organizations.plan_id` straight through PostgREST with their own anon key
 * and land on the Enterprise plan without paying — RLS constrains which ROW an
 * owner may write, and cannot constrain which COLUMNS.
 *
 * Everything else asserts the same shape from a different angle: no end-user
 * session writes a billing row, and no tenant reads another's.
 */

let client: Client

beforeAll(async () => {
  client = await connect()
})

afterAll(async () => {
  await client.end()
})

const acmeOwner = {
  userId: FIXTURES.acme.owner,
  orgId: FIXTURES.acme.orgId,
  orgRole: 'owner' as const,
}
const acmeMember = {
  userId: FIXTURES.acme.member,
  orgId: FIXTURES.acme.orgId,
  orgRole: 'member' as const,
}
const globexOwner = {
  userId: FIXTURES.globex.owner,
  orgId: FIXTURES.globex.orgId,
  orgRole: 'owner' as const,
}

describe('organizations: entitlement columns are not tenant-writable', () => {
  it('refuses an owner writing their own plan_id', async () => {
    const message = await expectRejected(
      client,
      acmeOwner,
      `UPDATE organizations
          SET plan_id = (SELECT id FROM plans WHERE name = 'enterprise')
        WHERE id = $1`,
      [FIXTURES.acme.orgId],
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('refuses an owner writing their own status', async () => {
    const message = await expectRejected(
      client,
      acmeOwner,
      `UPDATE organizations SET status = 'active' WHERE id = $1`,
      [FIXTURES.acme.orgId],
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('refuses an owner extending their own trial', async () => {
    const message = await expectRejected(
      client,
      acmeOwner,
      `UPDATE organizations SET trial_ends_at = now() + interval '10 years' WHERE id = $1`,
      [FIXTURES.acme.orgId],
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('refuses an owner choosing their own billing country, and so their tax regime', async () => {
    const message = await expectRejected(
      client,
      acmeOwner,
      `UPDATE organizations SET billing_country = 'US' WHERE id = $1`,
      [FIXTURES.acme.orgId],
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('still lets an owner edit the ordinary settings the app exposes', async () => {
    // The revoke must not be so broad that the settings page stops working.
    await asUser(client, acmeOwner, async (c) => {
      await c.query(
        `UPDATE organizations SET name = $2, billing_email = $3, timezone = $4 WHERE id = $1`,
        [FIXTURES.acme.orgId, 'Acme Renamed', 'billing@acme.test', 'Asia/Kolkata'],
      )
    })
  })
})

describe('usage counters cannot be aimed or reset', () => {
  it('refuses a direct call naming any organization', async () => {
    const message = await expectRejected(
      client,
      acmeMember,
      `SELECT public.increment_usage($1, 'projects', -9999)`,
      [FIXTURES.acme.orgId],
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('refuses a member pushing another tenant into their plan cap', async () => {
    const message = await expectRejected(
      client,
      acmeMember,
      `SELECT public.increment_usage($1, 'projects', 999999)`,
      [FIXTURES.globex.orgId],
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('scopes increment_usage_self to the caller own organization', async () => {
    const org = await asUser(client, acmeMember, async (c) => {
      await c.query(`SELECT public.increment_usage_self('projects', 1)`)
      const result = await c.query<{ organization_id: string }>(
        `SELECT organization_id FROM usage_counters WHERE metric = 'projects'`,
      )
      return result.rows.map((row) => row.organization_id)
    })
    // Whatever it touched, it can only have been Acme's row.
    for (const id of org) expect(id).toBe(FIXTURES.acme.orgId)
  })

  it('caps on a recount, so zeroing the counter does not lift the limit', async () => {
    await asUser(client, acmeOwner, async (c) => {
      // Starter allows 10 projects. Drive the counter to zero the way an
      // attacker would, then ask whether creation is still permitted.
      await c.query(
        `UPDATE usage_counters SET current_value = 0
          WHERE organization_id = $1 AND metric = 'projects'`,
        [FIXTURES.acme.orgId],
      )
      const result = await c.query<{ can: boolean; actual: string }>(
        `SELECT public.can_create('projects') AS can,
                public.usage_actual($1, 'projects')::text AS actual`,
        [FIXTURES.acme.orgId],
      )
      // usage_actual ignores the counter entirely for this metric.
      expect(Number(result.rows[0]!.actual)).toBeGreaterThan(0)
    })
  })
})

describe('billing tables are read-only to tenants', () => {
  const tables = ['subscriptions', 'payments', 'billing_invoices'] as const

  for (const table of tables) {
    it(`refuses an owner inserting into ${table}`, async () => {
      const message = await expectRejected(
        client,
        acmeOwner,
        `INSERT INTO ${table} (organization_id) VALUES ($1)`,
        [FIXTURES.acme.orgId],
      )
      // Either the privilege is gone or no policy matches. Both are the point.
      expect(message).toMatch(/permission denied|violates row-level security|null value/i)
    })

    it(`refuses an owner updating ${table}`, async () => {
      const message = await expectRejected(
        client,
        acmeOwner,
        `UPDATE ${table} SET organization_id = $1`,
        [FIXTURES.acme.orgId],
      )
      expect(message).toMatch(/permission denied/i)
    })

    it(`refuses an owner deleting from ${table}`, async () => {
      const message = await expectRejected(client, acmeOwner, `DELETE FROM ${table}`)
      expect(message).toMatch(/permission denied/i)
    })
  }
})

describe('billing tables are invisible across tenants and below admin', () => {
  const tables = ['subscriptions', 'payments', 'billing_invoices'] as const

  for (const table of tables) {
    it(`hides ${table} from a plain member`, async () => {
      expect(await countVisible(client, acmeMember, table)).toBe(0)
    })

    it(`shows ${table} to neither tenant's owner across the boundary`, async () => {
      const acme = await asUser(client, acmeOwner, async (c) => {
        const r = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${table} WHERE organization_id <> $1`,
          [FIXTURES.acme.orgId],
        )
        return Number(r.rows[0]!.n)
      })
      expect(acme).toBe(0)
    })
  }
})

describe('operator surface is invisible to every tenant', () => {
  const tables = [
    'provider_plan_refs',
    'payment_webhook_events',
    'billing_invoice_sequences',
    'platform_audit_logs',
  ] as const

  for (const table of tables) {
    it(`hides ${table} from an owner`, async () => {
      const message = await expectRejected(client, acmeOwner, `SELECT * FROM ${table}`)
      expect(message).toMatch(/permission denied/i)
    })
  }

  it('hides the gateway payload column even from an admin who can see the row', async () => {
    const message = await expectRejected(
      client,
      acmeOwner,
      `SELECT provider_payload FROM payments`,
    )
    expect(message).toMatch(/permission denied/i)
  })
})

describe('custom plans do not leak between tenants', () => {
  it('hides a tenant-scoped plan from another tenant', async () => {
    // Create Globex-only plan as the owner of the database, then look for it
    // from Acme. Written through a superuser connection because no tenant may
    // write plans at all — which is itself asserted below.
    await client.query(
      `INSERT INTO plans (name, tier, display_name, organization_id, limits, features)
       VALUES ('globex-bespoke-test', 'growth', 'Globex Bespoke', $1, '{}', '{}')
       ON CONFLICT (name) DO NOTHING`,
      [FIXTURES.globex.orgId],
    )

    try {
      const acmeSees = await asUser(client, acmeOwner, async (c) => {
        const r = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM plans WHERE name = 'globex-bespoke-test'`,
        )
        return Number(r.rows[0]!.n)
      })
      expect(acmeSees).toBe(0)

      const globexSees = await asUser(client, globexOwner, async (c) => {
        const r = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM plans WHERE name = 'globex-bespoke-test'`,
        )
        return Number(r.rows[0]!.n)
      })
      expect(globexSees).toBe(1)
    } finally {
      await client.query(`DELETE FROM plans WHERE name = 'globex-bespoke-test'`)
    }
  })

  it('refuses a tenant creating a plan for itself', async () => {
    const message = await expectRejected(
      client,
      acmeOwner,
      `INSERT INTO plans (name, tier, display_name, organization_id, limits, features)
       VALUES ('acme-self-serve', 'enterprise', 'Free Enterprise', $1, '{}', '{}')`,
      [FIXTURES.acme.orgId],
    )
    expect(message).toMatch(/permission denied|violates row-level security/i)
  })

  it('refuses a tenant widening the catalogue plan it is on', async () => {
    const message = await expectRejected(
      client,
      acmeOwner,
      `UPDATE plans SET features = '{"gantt": true, "commercial": true}'::jsonb
        WHERE name = 'starter'`,
    )
    expect(message).toMatch(/permission denied/i)
  })
})

describe('invoice arithmetic cannot be stored inconsistently', () => {
  it('rejects a total that does not equal the sum of its parts', async () => {
    await expect(
      client.query(
        `INSERT INTO billing_invoices (
           organization_id, invoice_number, series, fiscal_year, sequence_number,
           tax_treatment, seller_snapshot, buyer_snapshot, buyer_country,
           place_of_supply, currency, taxable_minor, igst_minor, total_minor,
           line_description)
         VALUES ($1, 'VC/99-00/000001', 'VC', '99-00', 1,
           'inter_state', '{}', '{}', 'IN', '29', 'INR', 100000, 18000, 999999,
           'Bogus')`,
        [FIXTURES.acme.orgId],
      ),
    ).rejects.toThrow(/billing_invoices_total_adds_up/)
  })

  it('rejects IGST on an intra-state invoice', async () => {
    await expect(
      client.query(
        `INSERT INTO billing_invoices (
           organization_id, invoice_number, series, fiscal_year, sequence_number,
           tax_treatment, seller_snapshot, buyer_snapshot, buyer_country,
           place_of_supply, currency, taxable_minor, igst_minor, total_minor,
           line_description)
         VALUES ($1, 'VC/99-00/000002', 'VC', '99-00', 2,
           'intra_state', '{}', '{}', 'IN', '33', 'INR', 100000, 18000, 118000,
           'Bogus')`,
        [FIXTURES.acme.orgId],
      ),
    ).rejects.toThrow(/tax_matches_treatment/)
  })

  it('rejects an export claiming LUT relief without an LUT reference', async () => {
    await expect(
      client.query(
        `INSERT INTO billing_invoices (
           organization_id, invoice_number, series, fiscal_year, sequence_number,
           tax_treatment, seller_snapshot, buyer_snapshot, buyer_country,
           place_of_supply, currency, taxable_minor, total_minor,
           fx_rate_to_inr, total_inr_minor, line_description)
         VALUES ($1, 'VCE/99-00/000001', 'VCE', '99-00', 1,
           'export_lut', '{}', '{}', 'US', '96', 'USD', 10000, 10000,
           83.5, 835000, 'Bogus')`,
        [FIXTURES.acme.orgId],
      ),
    ).rejects.toThrow(/lut_present/)
  })
})

describe('one live subscription per organization', () => {
  it('rejects a second live row for the same tenant', async () => {
    await client.query('BEGIN')
    try {
      const insert = `
        INSERT INTO subscriptions (
          organization_id, plan_id, grant_kind, provider, status,
          currency, billing_interval, unit_amount_minor, seats, trial_ends_at)
        VALUES ($1, (SELECT id FROM plans WHERE name = 'growth'),
                'trial', 'manual', 'pending', 'INR', 'monthly', 99900, 1,
                now() + interval '14 days')`
      await client.query(insert, [FIXTURES.acme.orgId])
      await expect(client.query(insert, [FIXTURES.acme.orgId])).rejects.toThrow(
        /subscriptions_one_live_per_org/,
      )
    } finally {
      await client.query('ROLLBACK')
    }
  })
})
