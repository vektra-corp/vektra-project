import { appError } from '@pm/shared/errors'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@pm/shared/types'
import type {
  PostgrestError,
  PostgrestResponse,
  PostgrestSingleResponse,
  SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * The client shape every service and query accepts.
 *
 * Must match what @supabase/ssr's createServerClient returns. That client is
 * instantiated with four generics, and `SupabaseClient<Database>` is a
 * *different* instantiation — TypeScript rejects the assignment on a protected
 * member rather than structurally, which makes the error look unrelated.
 */
export type Db = SupabaseClient<Database, 'public', 'public', Database['public']>

/**
 * Translate a PostgREST error into an AppError with a stable code.
 *
 * An RLS denial surfaces as an empty result on read and as code 42501 on write.
 * Both are reported as NOT_FOUND / FORBIDDEN rather than echoing the database
 * message, so a probe cannot learn whether a row exists in another tenant.
 */
export function mapDbError(error: PostgrestError): never {
  switch (error.code) {
    case '23505': // unique_violation
      throw appError('ALREADY_EXISTS', error.details || error.message)
    case '23503': // foreign_key_violation
      throw appError('VALIDATION_ERROR', 'Referenced record does not exist')
    case '23514': // check_violation
      throw appError('VALIDATION_ERROR', error.message)
    case '42501': // insufficient_privilege — RLS or a column-level revoke
      throw appError('FORBIDDEN', 'Not permitted')
    case 'PGRST116': // No rows returned for .single()
      throw appError('NOT_FOUND', 'Not found')
    default:
      throw appError('INTERNAL_ERROR', error.message)
  }
}

/**
 * Unwrap helpers.
 *
 * These take PostgREST's own response types rather than a structural stand-in.
 * A hand-written `{ data: T | null; error: ... }` parameter looks equivalent but
 * infers `T` as `never`, because the real response is a union whose failure
 * branch pins `data` to `null` — the row type is then silently lost at every
 * call site.
 */

/** Unwrap a `.single()` result. Missing rows are a NOT_FOUND error. */
export function unwrap<T>(result: PostgrestSingleResponse<T>): NonNullable<T> {
  if (result.error) mapDbError(result.error)
  if (result.data === null || result.data === undefined) {
    throw appError('NOT_FOUND', 'Not found')
  }
  return result.data as NonNullable<T>
}

/** Unwrap a list result, treating "no rows" as an empty array rather than an error. */
export function unwrapList<T>(result: PostgrestResponse<T>): T[] {
  if (result.error) mapDbError(result.error)
  return result.data ?? []
}

/** Unwrap a `.maybeSingle()` result. A missing row is `null`, not an error. */
export function unwrapMaybe<T>(result: PostgrestSingleResponse<T>): T | null {
  if (result.error && result.error.code !== 'PGRST116') mapDbError(result.error)
  return result.data ?? null
}

/**
 * Clamp a caller-supplied page size (§23.1 rule 3). An unbounded list query is
 * how one tenant's slow page becomes everyone's slow page.
 */
export function pageSize(requested?: number | null): number {
  if (!requested || requested < 1) return DEFAULT_PAGE_SIZE
  return Math.min(requested, MAX_PAGE_SIZE)
}

/**
 * Cursor pagination over a keyset. Offset pagination degrades on large tables
 * (§23.1 rule 4), so every list endpoint uses this instead.
 */
export interface Cursor {
  /** Value of the sort column on the last row of the previous page. */
  value: string
  /** Tie-breaker id, so rows with equal sort values page deterministically. */
  id: string
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.value}|${cursor.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(encoded: string | null | undefined): Cursor | null {
  if (!encoded) return null
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
    const separator = decoded.lastIndexOf('|')
    if (separator === -1) return null
    return { value: decoded.slice(0, separator), id: decoded.slice(separator + 1) }
  } catch {
    return null
  }
}

/**
 * Column lists. RULE (§23.1 rule 2): never `select('*')` in production code —
 * it ships columns the caller does not need and silently widens whenever a
 * migration adds one.
 */
export const COLUMNS = {
  profileSummary: 'id, full_name, avatar_url',
  taskCard:
    'id, title, status, priority, due_date, position, task_number, assignee_id, is_milestone, kanban_column_id, updated_at',
  taskDetail:
    'id, organization_id, project_id, kanban_column_id, title, description, status, priority, assignee_id, assigner_id, start_date, due_date, estimated_hours, actual_hours, position, task_number, is_milestone, started_at, completed_at, created_by, created_at, updated_at',
  projectListItem:
    'id, name, description, status, priority, start_date, end_date, visibility, workspace_id, updated_at',
  workspaceListItem: 'id, name, slug, description, color, icon',
} as const
