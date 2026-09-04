import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { functions } from '@/lib/inngest/functions'

/**
 * Inngest endpoint.
 *
 * Excluded from the auth middleware (see PUBLIC_ROUTE_PREFIXES) because Inngest
 * calls it machine-to-machine; the signing key is what authenticates the caller,
 * not a session cookie.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
})
