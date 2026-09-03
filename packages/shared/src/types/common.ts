/** Primitives shared across every module. */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }

export type UUID = string

/** Every table carries these (claude.md §6). */
export interface Timestamps {
  created_at: string
  updated_at: string
}

/** Every tenant-scoped row carries this (§2: denormalized for fast RLS). */
export interface TenantScoped {
  organization_id: UUID
}

/** Cursor pagination — the only list pagination used (§23.1 rule 4). */
export interface CursorPage<T> {
  items: T[]
  next_cursor: string | null
  has_more: boolean
}

export interface CursorParams {
  cursor?: string | null
  limit?: number
}

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

/** Postal address stored as jsonb on organizations and contacts. */
export interface Address {
  street?: string
  city?: string
  state?: string
  zip?: string
  country?: string
}

/** Minimal user shape joined onto most records for display. */
export interface UserSummary {
  id: UUID
  full_name: string
  avatar_url: string | null
}

/** Result of a mutation surfaced to a form. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> }
