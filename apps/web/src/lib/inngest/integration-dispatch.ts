import 'server-only'

import { describeEvent, parseSlackConfig } from '@pm/shared/constants'
import { signWebhook } from '@/lib/integrations/signature'
import { listChannels, postMessage } from '@/lib/integrations/slack'
import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from './client'
import { callWebhook } from './webhook-call'

/**
 * Integration dispatch (§12).
 *
 * Reads the event log and fans each event out to the org's connected
 * integrations and its outbound webhook endpoints.
 *
 * `events.processed` is this consumer's cursor. The workflow dispatcher
 * deliberately does not touch it (00024) precisely so that this one can own it;
 * workflows use a time window instead. That split is what lets both read the
 * same events without stealing them from each other.
 *
 * Delivery is at-most-once per destination per event, enforced by a unique
 * index rather than by care: the delivery row is written whatever the outcome,
 * so a retried batch collides instead of posting a second message to a channel.
 * For a notification, a missed message is better than a duplicate one.
 */

const BATCH_SIZE = 200

interface EventRow {
  id: string
  organization_id: string
  event_type: string
  payload: Record<string, unknown>
  actor_id: string | null
}

export const dispatchIntegrationEvents = inngest.createFunction(
  { id: 'integration-dispatch', retries: 2 },
  { cron: '*/2 * * * *' },
  async ({ step }) => {
    const batch = await step.run('claim-events', async () => {
      const db = createAdminClient()

      const { data: events } = await db
        .from('events')
        .select('id, organization_id, event_type, payload, actor_id')
        .eq('processed', false)
        .order('created_at')
        .limit(BATCH_SIZE)

      if (!events?.length) return { events: [] as EventRow[], integrations: [], webhooks: [] }

      const orgIds = [...new Set(events.map((event) => event.organization_id))]

      const [{ data: integrations }, { data: webhooks }] = await Promise.all([
        db
          .from('integrations')
          .select('id, organization_id, provider, config')
          .in('organization_id', orgIds)
          .eq('status', 'connected'),
        db
          .from('webhook_endpoints')
          .select('id, organization_id, url, events, secret')
          .in('organization_id', orgIds)
          .eq('is_active', true),
      ])

      return {
        events: events as EventRow[],
        integrations: integrations ?? [],
        webhooks: webhooks ?? [],
      }
    })

    if (batch.events.length === 0) return { events: 0, delivered: 0 }

    const result = await step.run('deliver', async () => {
      const db = createAdminClient()
      const key = process.env.INTEGRATION_ENCRYPTION_KEY

      // Actor names, in one query rather than one per event.
      const actorIds = [...new Set(batch.events.map((e) => e.actor_id).filter(Boolean))] as string[]
      const { data: profiles } = actorIds.length
        ? await db.from('profiles').select('id, full_name').in('id', actorIds)
        : { data: [] }
      const nameFor = new Map((profiles ?? []).map((p) => [p.id, p.full_name]))

      // Decrypt each integration's token once, not once per event.
      const tokens = new Map<string, string>()
      for (const integration of batch.integrations) {
        if (!key) break
        const { data, error } = await db.rpc('integration_access_token', {
          p_integration: integration.id,
          p_key: key,
        })
        // A key rotation makes decryption raise rather than return null. Mark
        // the integration rather than failing the whole batch for every org.
        if (error || !data) {
          await db
            .from('integrations')
            .update({ status: 'error', last_error: 'Stored credential could not be read' })
            .eq('id', integration.id)
          continue
        }
        tokens.set(integration.id, data)
      }

      let delivered = 0

      for (const event of batch.events) {
        const text = describeEvent({
          eventType: event.event_type,
          payload: event.payload ?? {},
          actorName: event.actor_id ? nameFor.get(event.actor_id) : null,
        })

        for (const integration of batch.integrations) {
          if (integration.organization_id !== event.organization_id) continue
          if (integration.provider !== 'slack') continue

          const config = parseSlackConfig(integration.config)
          if (!config.channelId) continue
          if (!config.events.includes(event.event_type)) continue

          const token = tokens.get(integration.id)
          if (!token) continue

          const began = Date.now()
          const sent = await postMessage(token, config.channelId, text)

          // Written whether it worked or not: the unique index on
          // (destination, event) is what makes a retry safe, so the row has to
          // exist even for a failure.
          const { error: clash } = await db.from('integration_deliveries').insert({
            organization_id: event.organization_id,
            integration_id: integration.id,
            event_id: event.id,
            event_type: event.event_type,
            status: sent.ok ? 'delivered' : 'failed',
            detail: sent.error ?? null,
            duration_ms: Date.now() - began,
          })

          if (!clash && sent.ok) delivered += 1

          if (!sent.ok) {
            await db
              .from('integrations')
              .update({ status: 'error', last_error: sent.error ?? 'Delivery failed' })
              .eq('id', integration.id)
          }
        }

        for (const webhook of batch.webhooks) {
          if (webhook.organization_id !== event.organization_id) continue
          if (!webhook.events.includes(event.event_type)) continue

          const began = Date.now()
          const timestamp = String(Math.floor(began / 1000))
          const body = JSON.stringify({
            event: event.event_type,
            organization_id: event.organization_id,
            payload: event.payload,
            timestamp,
          })

          // Through callWebhook, not a bare fetch. It is the one place that
          // resolves the host and refuses a private address — the column CHECK
          // only forces https, which 127.0.0.1 and 169.254.169.254 both satisfy.
          // An inline fetch here was exactly that hole, on the other path.
          //
          // `serialized` matters: the HMAC covers these bytes, so the request
          // must send the same ones rather than a re-stringified equivalent.
          const outcome = await callWebhook(
            webhook.url,
            {},
            {
              serialized: body,
              headers: {
                'X-PM-Event': event.event_type,
                'X-PM-Timestamp': timestamp,
                'X-PM-Signature': `sha256=${signWebhook(webhook.secret, timestamp, body)}`,
              },
            },
          )

          const ok = outcome.ok
          const detail = ok ? null : outcome.reason

          const { error: clash } = await db.from('integration_deliveries').insert({
            organization_id: event.organization_id,
            webhook_id: webhook.id,
            event_id: event.id,
            event_type: event.event_type,
            status: ok ? 'delivered' : 'failed',
            detail,
            duration_ms: Date.now() - began,
          })

          if (!clash && ok) delivered += 1

          await db
            .from('webhook_endpoints')
            .update(
              ok
                ? { last_success_at: new Date().toISOString(), failure_count: 0 }
                : { last_failure_at: new Date().toISOString() },
            )
            .eq('id', webhook.id)
        }
      }

      // Marked last. An event marked processed before delivery would be lost
      // outright if this step failed; marked after, the worst case is the
      // duplicate the unique index already refuses.
      await db
        .from('events')
        .update({ processed: true })
        .in(
          'id',
          batch.events.map((event) => event.id),
        )

      return { events: batch.events.length, delivered }
    })

    return result
  },
)

/** Channels for the settings picker. Kept here so the token never leaves the server. */
export async function slackChannelsFor(integrationId: string) {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return { ok: false as const, error: 'Slack is not configured' }

  const db = createAdminClient()
  const { data: token, error } = await db.rpc('integration_access_token', {
    p_integration: integrationId,
    p_key: key,
  })

  if (error || !token) return { ok: false as const, error: 'Stored credential could not be read' }
  return listChannels(token)
}
