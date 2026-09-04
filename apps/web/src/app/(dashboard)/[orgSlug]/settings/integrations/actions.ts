'use server'

import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { INTEGRATION_SUBSCRIBABLE_EVENTS, parseSlackConfig } from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { slackChannelsFor } from '@/lib/inngest/integration-dispatch'
import { createClient } from '@/lib/supabase/server'

/**
 * Integration settings (§12).
 *
 * Connecting happens in the OAuth routes; this covers everything after: which
 * channel to post to, which events to send, and disconnecting.
 *
 * The access token is never read here. Listing channels needs it, so that goes
 * through `slackChannelsFor`, which decrypts server-side and returns only the
 * channel names — the token itself never reaches an action's return value and
 * therefore never crosses to the client.
 */

async function assertAdmin(orgSlug: string) {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) {
    throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', status: 403 })
  }
  return auth
}

export async function listSlackChannels(
  orgSlug: string,
): Promise<ActionResult<{ id: string; name: string }[]>> {
  try {
    const auth = await assertAdmin(orgSlug)
    const supabase = createClient()

    const { data: integration } = await supabase
      .from('integrations')
      .select('id')
      .eq('organization_id', auth.orgId)
      .eq('provider', 'slack')
      .maybeSingle()

    if (!integration) return { ok: false, code: 'NOT_FOUND', message: 'Slack is not connected.' }

    const result = await slackChannelsFor(integration.id)
    if (!result.ok) {
      return { ok: false, code: 'INTERNAL_ERROR', message: result.error ?? 'Could not reach Slack.' }
    }

    return { ok: true, data: result.data ?? [] }
  } catch (error) {
    return toActionError(error)
  }
}

export async function saveSlackConfig(
  orgSlug: string,
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const auth = await assertAdmin(orgSlug)
    const supabase = createClient()

    const { data: integration } = await supabase
      .from('integrations')
      .select('id, config')
      .eq('organization_id', auth.orgId)
      .eq('provider', 'slack')
      .maybeSingle()

    if (!integration) return { ok: false, code: 'NOT_FOUND', message: 'Slack is not connected.' }

    const current = parseSlackConfig(integration.config)
    const channelId = String(formData.get('channelId') ?? '').trim() || null
    const channelName = String(formData.get('channelName') ?? '').trim() || null

    // Only events this app can actually emit; an unrecognised one from a
    // tampered form would sit in the config forever and never match.
    const events = formData
      .getAll('events')
      .filter(
        (value): value is string =>
          typeof value === 'string'
          && (INTEGRATION_SUBSCRIBABLE_EVENTS as readonly string[]).includes(value),
      )

    const { error } = await supabase
      .from('integrations')
      .update({
        config: { ...current, channelId, channelName, events },
        // Choosing a channel is also how someone recovers from a delivery
        // failure, so clear the error state they are acting on.
        status: 'connected',
        last_error: null,
      })
      .eq('id', integration.id)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(`/${orgSlug}/settings/integrations`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function disconnectSlack(orgSlug: string): Promise<ActionResult<null>> {
  try {
    const auth = await assertAdmin(orgSlug)
    const supabase = createClient()

    // Deleted, not marked disconnected: the row holds an encrypted credential
    // for a third-party workspace, and "disconnected" would keep it around
    // indefinitely for an integration nobody is using.
    const { error } = await supabase
      .from('integrations')
      .delete()
      .eq('organization_id', auth.orgId)
      .eq('provider', 'slack')

    if (error) throw error

    revalidatePath(`/${orgSlug}/settings/integrations`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
