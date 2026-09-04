import 'server-only'

import { lookup } from 'node:dns/promises'
import {
  WEBHOOK_MAX_REDIRECTS,
  WEBHOOK_MAX_RESPONSE_BYTES,
  WEBHOOK_TIMEOUT_MS,
  checkWebhookUrl,
  isBlockedAddress,
} from '@/lib/net/ssrf'

/**
 * Call a customer-supplied URL, safely (§13).
 *
 * The rules live in `lib/net/ssrf` so they can be tested without a network;
 * this is the part that has to touch one. Every hop is re-validated, because a
 * URL that passes on the way in is free to redirect to 127.0.0.1 on the way
 * out.
 */

export interface WebhookOutcome {
  ok: boolean
  status?: number
  body?: string
  reason: string
}

/** Resolve a hostname and refuse it if ANY address it answers with is private. */
async function hostIsSafe(hostname: string): Promise<string | null> {
  // An IP literal needs no lookup — and must not get one, since `lookup` would
  // happily echo it back.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    return isBlockedAddress(hostname) ? `${hostname} is not a public address` : null
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true })
  } catch {
    return `Could not resolve ${hostname}`
  }

  if (addresses.length === 0) return `Could not resolve ${hostname}`

  // ALL of them, not the first: a host can answer with one public and one
  // private record and the connection may take either.
  const bad = addresses.find((entry) => isBlockedAddress(entry.address))
  return bad ? `${hostname} resolves to a private address` : null
}

/**
 * @param serialized  Pre-serialized body, when the caller must sign the exact
 *                    bytes it sends. Re-stringifying an object here would
 *                    produce different bytes from the ones an HMAC covers.
 * @param headers     Extra headers, e.g. a signature.
 */
export async function callWebhook(
  rawUrl: string,
  body: Record<string, unknown>,
  options: { serialized?: string; headers?: Record<string, string> } = {},
): Promise<WebhookOutcome> {
  let current = rawUrl

  for (let hop = 0; hop <= WEBHOOK_MAX_REDIRECTS; hop += 1) {
    const verdict = checkWebhookUrl(current)
    if (!verdict.ok) return { ok: false, reason: verdict.reason }

    const unsafe = await hostIsSafe(verdict.url.hostname)
    if (unsafe) return { ok: false, reason: unsafe }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(verdict.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ProjectManagement-Workflow/1.0',
          ...(options.headers ?? {}),
        },
        body: options.serialized ?? JSON.stringify(body),
        // Followed by hand so each hop is re-checked against the rules above.
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError'
        ? `Timed out after ${WEBHOOK_TIMEOUT_MS}ms`
        : 'Request failed'
      return { ok: false, reason }
    } finally {
      clearTimeout(timer)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { ok: false, reason: `Redirect with no location (${response.status})` }
      current = new URL(location, verdict.url).toString()
      continue
    }

    // Read a bounded prefix: the response is only ever shown in a step log, and
    // an unbounded read is a memory problem waiting for a hostile endpoint.
    let text = ''
    try {
      const raw = await response.text()
      text = raw.slice(0, WEBHOOK_MAX_RESPONSE_BYTES)
    } catch {
      text = ''
    }

    return response.ok
      ? { ok: true, status: response.status, body: text, reason: 'ok' }
      : { ok: false, status: response.status, body: text, reason: `Endpoint returned ${response.status}` }
  }

  return { ok: false, reason: `More than ${WEBHOOK_MAX_REDIRECTS} redirects` }
}
