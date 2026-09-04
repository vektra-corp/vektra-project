import 'server-only'

import { isOwnStorageUrl } from './logo-origin'

export { isOwnStorageUrl }

/**
 * Fetch an organisation's logo for embedding in a PDF.
 *
 * The PDF renderer will happily fetch an `Image src` itself, which would make
 * every PDF request an outbound request to a URL a customer controls — the same
 * SSRF hole the workflow webhook action had, reached from a different door. So
 * the renderer never sees a URL: this fetches, checks, and returns a data URI.
 *
 * The check is an ORIGIN ALLOWLIST, not the private-range test used for
 * webhooks. A logo can only ever live in our own Supabase Storage, so anything
 * else is refused outright rather than reasoned about.
 *
 * Failure is always null, never a throw. A missing logo must not turn a PDF
 * download into a 500.
 */

/** Comfortably larger than any reasonable logo, small enough to be harmless. */
const MAX_LOGO_BYTES = 512 * 1024
const LOGO_TIMEOUT_MS = 4000

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg'])

export async function fetchLogoDataUri(
  logoUrl: string | null | undefined,
): Promise<string | null> {
  if (!logoUrl) return null
  if (!isOwnStorageUrl(logoUrl, process.env.NEXT_PUBLIC_SUPABASE_URL)) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOGO_TIMEOUT_MS)

  try {
    const response = await fetch(logoUrl, {
      signal: controller.signal,
      // Our own storage will not redirect off-origin; if it ever did, following
      // it would leave the allowlist behind.
      redirect: 'error',
    })
    if (!response.ok) return null

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim()
    // @react-pdf/renderer decodes PNG and JPEG only. An SVG would also be an
    // XML parser reached with customer-supplied bytes.
    if (!ALLOWED_TYPES.has(contentType)) return null

    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_LOGO_BYTES) return null

    const bytes = new Uint8Array(await response.arrayBuffer())
    // Re-check after reading: content-length is a claim, not a guarantee.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) return null

    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
