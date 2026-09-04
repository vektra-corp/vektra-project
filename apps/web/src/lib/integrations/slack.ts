import 'server-only'

import { escapeSlackText } from './slack-text'

/**
 * Slack Web API client (§12).
 *
 * Only the three calls we actually need: exchange an OAuth code, list channels
 * for the settings picker, and post a message. No SDK — the SDK is large, and
 * three `fetch` calls with explicit error handling are easier to reason about
 * than a dependency that retries and rate-limits on its own schedule.
 *
 * Slack answers 200 with `{ ok: false, error }` for application errors, so a
 * check on `response.ok` alone would treat "invalid_auth" as success. Every
 * call here reads the body's `ok` field.
 */

export { escapeSlackText }

const SLACK_API = 'https://slack.com/api'
const TIMEOUT_MS = 10_000

export interface SlackResult<T> {
  ok: boolean
  data?: T
  error?: string
}

async function call<T>(
  method: string,
  init: RequestInit & { token?: string },
): Promise<SlackResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(`${SLACK_API}/${method}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers ?? {}),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
    })

    const body = (await response.json()) as { ok?: boolean; error?: string } & T
    if (!body.ok) return { ok: false, error: body.error ?? `HTTP ${response.status}` }
    return { ok: true, data: body }
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError' ? 'Slack timed out' : 'Slack call failed'
    return { ok: false, error: reason }
  } finally {
    clearTimeout(timer)
  }
}

export interface SlackOAuthResult {
  access_token: string
  team?: { id?: string; name?: string }
}

/** Exchange an OAuth code for a bot token. */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<SlackResult<SlackOAuthResult>> {
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) return { ok: false, error: 'Slack is not configured' }

  return call<SlackOAuthResult>('oauth.v2.access', {
    method: 'POST',
    // Slack's token endpoint takes form encoding, not JSON.
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}

export interface SlackChannel {
  id: string
  name: string
}

/** Public channels the bot can post to, for the settings picker. */
export async function listChannels(token: string): Promise<SlackResult<SlackChannel[]>> {
  const result = await call<{ channels?: { id: string; name: string; is_archived?: boolean }[] }>(
    'conversations.list?types=public_channel&exclude_archived=true&limit=200',
    { method: 'GET', token },
  )

  if (!result.ok) return { ok: false, error: result.error }

  const channels = (result.data?.channels ?? [])
    .filter((channel) => !channel.is_archived)
    .map((channel) => ({ id: channel.id, name: channel.name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { ok: true, data: channels }
}

export async function postMessage(
  token: string,
  channel: string,
  text: string,
): Promise<SlackResult<{ ts?: string }>> {
  return call<{ ts?: string }>('chat.postMessage', {
    method: 'POST',
    token,
    body: JSON.stringify({ channel, text: escapeSlackText(text) }),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
