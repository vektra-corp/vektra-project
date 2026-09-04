import { NextResponse, type NextRequest } from 'next/server'
import { inngest } from '@/lib/inngest/client'
import { hashWebhookToken } from '@/lib/net/webhook-token'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Inbound trigger for webhook-driven workflows (§11).
 *
 * The token in the path IS the credential — there is no session here, and the
 * caller is an external system that cannot hold one. That shapes everything:
 *
 *  - The token is compared by hash. The database stores only the hash (00025),
 *    so a leaked backup or a curious member reading the row learns nothing.
 *  - Rate limited on the token, not the IP: a caller behind a NAT or a serverless
 *    platform shares an address with everyone else on it, and the token is the
 *    thing we actually want to bound.
 *  - Every failure answers exactly the same way. Distinguishing "no such token"
 *    from "workflow is paused" would turn this endpoint into an oracle for
 *    guessing tokens.
 *  - The body is capped and parsed defensively; it goes on to become a workflow
 *    payload, and conditions read fields straight out of it.
 *
 * This route is excluded from auth middleware, like the Stripe and Inngest
 * routes, because it is called machine-to-machine.
 */

export const runtime = 'nodejs'

/** Enough for a rich payload; far short of a memory problem. */
const MAX_BODY_BYTES = 64 * 1024

const accepted = () => NextResponse.json({ received: true }, { status: 202 })

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token ?? ''

  // A token that is not even the right shape never reaches the database.
  if (token.length < 20 || token.length > 200) return accepted()

  const limit = await checkRateLimit('webhook', `wf:${token}`)
  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many requests', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' },
      { status: 413 },
    )
  }

  let body: unknown = {}
  if (raw.trim()) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Body must be JSON', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
  }

  const db = createAdminClient()
  const { data: workflow } = await db
    .from('workflows')
    .select('id, is_active, trigger_type')
    .eq('webhook_token_hash', hashWebhookToken(token))
    .maybeSingle()

  // Unknown, paused, or not a webhook workflow — all answer identically, so a
  // caller cannot use the response to learn which.
  if (!workflow || !workflow.is_active || workflow.trigger_type !== 'webhook') {
    return accepted()
  }

  await inngest.send({
    name: 'workflow/run',
    data: {
      workflow_id: workflow.id,
      trigger: {
        // Each delivery is its own occurrence: unlike a database event, an
        // inbound call has no natural id to deduplicate on, and a caller that
        // sends twice means it twice.
        id: `webhook:${workflow.id}:${crypto.randomUUID()}`,
        eventType: 'workflow.webhook',
        payload: {
          source: 'webhook',
          // Conditions read dotted paths, and `new` is where the planner looks
          // first, so an inbound body reads the same way a row event does.
          new: body && typeof body === 'object' && !Array.isArray(body) ? body : { value: body },
          received_at: new Date().toISOString(),
        },
      },
    },
  })

  return accepted()
}

/** A GET is almost always someone testing the URL in a browser. Say so. */
export function GET() {
  return NextResponse.json(
    { error: 'Use POST to trigger this workflow', code: 'METHOD_NOT_ALLOWED' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
