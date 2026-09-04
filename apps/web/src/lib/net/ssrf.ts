/**
 * Outbound-request safety for user-supplied URLs (§13).
 *
 * A workflow's `call_webhook` action lets a customer name a URL the server will
 * fetch. That is a server-side request forgery primitive unless it is
 * constrained: our server sits inside a network the caller does not otherwise
 * reach, and cloud metadata endpoints (169.254.169.254) hand out credentials to
 * anything that asks from inside.
 *
 * The rules, in order of what they stop:
 *
 *  1. Scheme — only http/https. `file:`, `gopher:` and friends read local
 *     resources or smuggle protocols.
 *  2. Port — only the standard web ports. Blocking the rest keeps a webhook
 *     from being used as an internal port scanner.
 *  3. Address — every resolved IP must be public. Resolution happens in the
 *     caller (this module stays pure so it is testable); `isBlockedAddress`
 *     judges the result. Checking *all* resolved addresses matters: a hostname
 *     can return one public and one private A record.
 *  4. Redirects — followed manually, re-validating each hop, because a public
 *     URL is free to redirect to 127.0.0.1.
 *
 * DNS rebinding is not fully solved here — between our lookup and the socket's
 * own lookup the record can change. Closing that needs a pinned-IP agent, which
 * is noted in PROJECT-STATUS.md rather than pretended away.
 */

export const ALLOWED_WEBHOOK_PORTS = new Set([80, 443, 8080, 8443])

export interface UrlProblem {
  ok: false
  reason: string
}
export interface UrlOk {
  ok: true
  url: URL
}
export type UrlVerdict = UrlOk | UrlProblem

/** Structural checks that need no network. */
export function checkWebhookUrl(raw: string): UrlVerdict {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'Not a valid URL' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Scheme ${url.protocol} is not allowed` }
  }

  // Credentials in the URL get forwarded to whatever it redirects to.
  if (url.username || url.password) {
    return { ok: false, reason: 'Credentials in the URL are not allowed' }
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (!ALLOWED_WEBHOOK_PORTS.has(port)) {
    return { ok: false, reason: `Port ${port} is not allowed` }
  }

  if (!url.hostname) return { ok: false, reason: 'No host in the URL' }

  // A bare hostname with no dot is an internal name (`redis`, `localhost`).
  if (!url.hostname.includes('.') && !url.hostname.includes(':')) {
    return { ok: false, reason: 'Host must be a fully qualified domain name' }
  }

  return { ok: true, url }
}

const parseIPv4 = (value: string): number[] | null => {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN
    return Number(part)
  })
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null
}

/**
 * Whether an IP literal must not be fetched.
 *
 * Unknown or unparseable input returns true. Failing closed is the whole point:
 * an address we cannot classify is not one to connect to (§2).
 */
export function isBlockedAddress(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!value) return true

  const v4 = parseIPv4(value)
  if (v4) {
    const [a, b] = v4 as [number, number, number, number]
    if (a === 0) return true // "this network"
    if (a === 10) return true // private
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    if (a === 192 && b === 0) return true // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
    if (a >= 224) return true // multicast, reserved, broadcast
    return false
  }

  // IPv6.
  if (value.includes(':')) {
    if (value === '::' || value === '::1') return true // unspecified, loopback
    // IPv4-mapped (::ffff:127.0.0.1) inherits the v4 verdict.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value)
    if (mapped) return isBlockedAddress(mapped[1]!)
    if (/^f[cd]/.test(value)) return true // unique local fc00::/7
    if (/^fe[89ab]/.test(value)) return true // link-local fe80::/10
    if (/^ff/.test(value)) return true // multicast
    if (value.startsWith('64:ff9b:')) return true // NAT64, reaches v4 space
    if (value.startsWith('2002:')) return true // 6to4, likewise
    return false
  }

  // Not an IP literal at all — the caller resolves names before asking.
  return true
}

export const WEBHOOK_TIMEOUT_MS = 10_000
export const WEBHOOK_MAX_REDIRECTS = 3
/** Enough to see an error message; not enough to be a memory problem. */
export const WEBHOOK_MAX_RESPONSE_BYTES = 8 * 1024
