/**
 * Application error with a stable, translatable error code.
 *
 * claude.md §21.8: the API never sends localized text. It returns an error CODE
 * and the client maps that code to a translated string. `message` is for logs
 * and developers, never for direct display to end users.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly status: number = 400,
    /** Safe, non-sensitive values for interpolation into the translated message. */
    public readonly params?: Record<string, string | number>,
  ) {
    super(message)
    this.name = 'AppError'
  }

  toJSON() {
    return { error: this.message, code: this.code, params: this.params }
  }
}

export const ERROR_CODES = [
  // Auth
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CSRF_VIOLATION',
  'SESSION_EXPIRED',
  'MFA_REQUIRED',
  // Validation
  'VALIDATION_ERROR',
  'INVALID_STATUS',
  'PAYLOAD_TOO_LARGE',
  // Resources
  'NOT_FOUND',
  'CONFLICT',
  'ALREADY_EXISTS',
  // Limits
  'RATE_LIMITED',
  'PLAN_LIMIT',
  'WIP_LIMIT',
  'FEATURE_NOT_AVAILABLE',
  // Billing
  'SUBSCRIPTION_REQUIRED',
  'PAYMENT_FAILED',
  // Files
  'UNSUPPORTED_FILE_TYPE',
  'FILE_TOO_LARGE',
  // Generic
  'INTERNAL_ERROR',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** HTTP status for each error code, so callers never hand-pick a mismatched pair. */
const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CSRF_VIOLATION: 403,
  SESSION_EXPIRED: 401,
  MFA_REQUIRED: 403,
  VALIDATION_ERROR: 400,
  INVALID_STATUS: 400,
  PAYLOAD_TOO_LARGE: 413,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ALREADY_EXISTS: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT: 403,
  WIP_LIMIT: 400,
  FEATURE_NOT_AVAILABLE: 403,
  SUBSCRIPTION_REQUIRED: 402,
  PAYMENT_FAILED: 402,
  UNSUPPORTED_FILE_TYPE: 415,
  FILE_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
}

/** Build an AppError with the canonical status for its code. */
export function appError(
  code: ErrorCode,
  message: string,
  params?: Record<string, string | number>,
): AppError {
  return new AppError(message, code, DEFAULT_STATUS[code], params)
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * Convert any thrown value into a client-safe payload.
 * Unknown errors are flattened to INTERNAL_ERROR so internals never leak (§13.8).
 */
export function toClientError(error: unknown): {
  body: { error: string; code: ErrorCode; params?: Record<string, string | number> }
  status: number
} {
  if (isAppError(error)) {
    return { body: error.toJSON(), status: error.status }
  }
  return { body: { error: 'Internal server error', code: 'INTERNAL_ERROR' }, status: 500 }
}
