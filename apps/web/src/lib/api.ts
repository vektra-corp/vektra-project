import 'server-only'

import { clientIp, isAllowedOrigin } from '@pm/auth/middleware'
import { assertCan } from '@pm/auth/rbac'
import type { Action, AuthContext, Module, OrgRole } from '@pm/auth/types'
import { appError, toClientError } from '@pm/shared/errors'
import * as Sentry from '@sentry/nextjs'
import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth/context'
import { enforceRateLimit, type RateLimiterName } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

export interface SecureContext extends AuthContext {
  supabase: ReturnType<typeof createClient>
  ip: string
}

export interface SecureRouteOptions {
  requiredRole?: readonly OrgRole[]
  requiredPermission?: { module: Module; action: Action }
  rateLimit?: RateLimiterName
  /** Bytes. Oversized bodies are rejected before parsing (§13.8). */
  maxBodySize?: number
  /** Set false only for routes that verify a provider signature instead (§13.4). */
  csrf?: boolean
}

const DEFAULT_MAX_BODY = 1_048_576 // 1 MB

/**
 * The full security chain for an API route (claude.md §13.8), in order:
 *   rate limit -> CSRF origin -> body size -> auth -> role -> permission
 *
 * Errors never leak internals: an AppError returns its code, anything else is
 * flattened to INTERNAL_ERROR and logged.
 */
export function secureApiRoute(
  handler: (request: NextRequest, context: SecureContext) => Promise<NextResponse>,
  options: SecureRouteOptions = {},
) {
  return async function handleRequest(request: NextRequest): Promise<NextResponse> {
    try {
      const ip = clientIp(request.headers)

      if (options.rateLimit) {
        await enforceRateLimit(options.rateLimit, ip)
      }

      // State-changing requests must come from one of our own origins.
      const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
      if (isMutation && options.csrf !== false) {
        const allowed = [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_ADMIN_URL]
        if (!isAllowedOrigin(request.headers.get('origin'), allowed)) {
          throw appError('CSRF_VIOLATION', 'Invalid origin')
        }
      }

      const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10)
      if (contentLength > (options.maxBodySize ?? DEFAULT_MAX_BODY)) {
        throw appError('PAYLOAD_TOO_LARGE', 'Request body too large')
      }

      const auth = await getAuthContext()
      if (!auth) throw appError('UNAUTHORIZED', 'Not signed in')

      if (options.requiredRole && !options.requiredRole.includes(auth.orgRole)) {
        throw appError('FORBIDDEN', 'Insufficient role')
      }

      if (options.requiredPermission) {
        assertCan(auth, options.requiredPermission.module, options.requiredPermission.action)
      }

      // Per-user limit on top of the per-IP one, so one account cannot burn a
      // shared office IP's budget for everyone behind it.
      if (options.rateLimit) {
        await enforceRateLimit(options.rateLimit, auth.userId)
      }

      return await handler(request, { ...auth, supabase: createClient(), ip })
    } catch (error) {
      const { body, status } = toClientError(error)
      if (status >= 500) {
        // §13.11: unexpected failures go to Sentry with the route attached.
        // AppErrors are deliberate 4xx responses and are not reported.
        Sentry.captureException(error, {
          tags: { route: request.nextUrl.pathname, method: request.method },
        })
        console.error('[api]', error)
      }
      const headers = new Headers()
      if (body.code === 'RATE_LIMITED' && body.params?.retryAfter) {
        headers.set('Retry-After', String(body.params.retryAfter))
      }
      return NextResponse.json(body, { status, headers })
    }
  }
}
