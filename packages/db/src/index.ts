export type { Database, Json, Tables, TablesInsert, TablesUpdate } from './types'
export * from './helpers'
export * from './queries'
export * from './services'

import type { Database } from './types'

/**
 * Convenience alias the generated file does not provide.
 *
 * `packages/db/src/types.ts` is produced verbatim by `supabase gen types`, so
 * anything hand-written must live here or it would be lost on the next
 * regeneration.
 */
export type TableName = keyof Database['public']['Tables']
