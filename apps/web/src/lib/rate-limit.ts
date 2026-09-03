import 'server-only'

import { appError } from '@pm/shared/errors'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * Rate limiting (claude.md §13.7).
 *
 * Limits are keyed by IP for unauthenticated routes, by user id for
 * authenticated ones, and by org id for org-scoped bulk work.
 *
 * When Upstash is not configured (local development), limiting is skipped
 * rather than failing closed — a developer without Redis should still be able
 * to run the app, and there is no tenant boundary at stake here.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null

function limiter(requests: number, window: Parameters<typeof Ratelimit.slidingWindow>[1], prefix: string) {
  if (!redis) return null
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix,
    analytics: true,
  })
}

export const rateLimiters = {
  auth: limiter(5, '1 m', 'rl:auth'), // 5 login attempts per minute
  api: limiter(120, '1 m', 'rl:api'), // 120 API calls per minute
  upload: limiter(20, '1 m', 'rl:upload'), // 20 uploads per minute
  webhook: limiter(100, '1 m', 'rl:webhook'),
  export: limiter(5, '10 m', 'rl:export'), // 5 exports per 10 minutes
} as const

export type RateLimiterName = keyof typeof rateLimiters

export interface RateLimitResult {
  success: boolean
  remaining: number
  /** Seconds until the window resets, for the Retry-After header. */
  retryAfter: number
}

export async function checkRateLimit(
  name: RateLimiterName,
  identifier: string,
): Promise<RateLimitResult> {
  const instance = rateLimiters[name]
  if (!instance) return { success: true, remaining: Number.POSITIVE_INFINITY, retryAfter: 0 }

  const { success, remaining, reset } = await instance.limit(identifier)
  return {
    success,
    remaining,
    retryAfter: Math.max(0, Math.ceil((reset - Date.now()) / 1000)),
  }
}

/** Throws a 429 AppError when the limit is exceeded. */
export async function enforceRateLimit(
  name: RateLimiterName,
  identifier: string,
): Promise<RateLimitResult> {
  const result = await checkRateLimit(name, identifier)
  if (!result.success) {
    throw appError('RATE_LIMITED', 'Too many requests', { retryAfter: result.retryAfter })
  }
  return result
}
