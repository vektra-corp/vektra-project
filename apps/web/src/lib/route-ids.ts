import { parsePublicId, publicIdToString } from '@pm/shared/utils'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Resolve the identifiers a URL carries.
 *
 * Routes carry each row's 16-digit `public_id` (migration 00034); everything
 * below the route boundary — every foreign key, every RLS check — still speaks
 * uuid. These are the only places that translate, so no page has to remember
 * which of the two it is holding.
 *
 * Each resolver is wrapped in React's `cache`, so a layout and the page it
 * wraps share one round trip: both need the project, and both call this.
 *
 * A malformed id is rejected before the database is touched. It cannot match a
 * row, and querying for it anyway would let someone probe the table with
 * rubbish. Every resolver returns null rather than throwing, so the caller
 * answers with a 404 — which is also what another tenant's id gets, since RLS
 * makes the two indistinguishable on purpose.
 */

export interface ResolvedProject {
  /** Internal uuid. Never rendered, never put in a URL. */
  id: string
  /** The 16-digit id the URL carried, echoed back for building links. */
  publicId: string
  /** Editable, unique-per-org key shown in task references (VEK-241). */
  key: string
  name: string
  workspaceId: string
}

export const resolveProject = cache(
  async (routeParam: string): Promise<ResolvedProject | null> => {
    const publicId = parsePublicId(routeParam)
    if (!publicId) return null

    const supabase = createClient()
    const { data } = await supabase
      .from('projects')
      .select('id, public_id, key, name, workspace_id')
      // The column is bigint; the route parameter is the digits. Every
      // generated id is below 2^53 by construction (migration 00034), so this
      // conversion is exact rather than merely close.
      .eq('public_id', Number(publicId))
      .maybeSingle()

    if (!data) return null

    return {
      id: data.id,
      publicId: publicIdToString(data.public_id),
      key: data.key,
      name: data.name,
      workspaceId: data.workspace_id,
    }
  },
)

export interface ResolvedTask {
  id: string
  publicId: string
  projectId: string
}

export const resolveTask = cache(async (routeParam: string): Promise<ResolvedTask | null> => {
  const publicId = parsePublicId(routeParam)
  if (!publicId) return null

  const supabase = createClient()
  const { data } = await supabase
    .from('tasks')
    .select('id, public_id, project_id')
    .eq('public_id', Number(publicId))
    .maybeSingle()

  if (!data) return null
  return { id: data.id, publicId: publicIdToString(data.public_id), projectId: data.project_id }
})

export interface ResolvedDocument {
  id: string
  publicId: string
  projectId: string
}

export const resolveDocument = cache(
  async (routeParam: string): Promise<ResolvedDocument | null> => {
    const publicId = parsePublicId(routeParam)
    if (!publicId) return null

    const supabase = createClient()
    const { data } = await supabase
      .from('documents')
      .select('id, public_id, project_id')
      // The column is bigint; the route parameter is the digits. Every
      // generated id is below 2^53 by construction (migration 00034), so this
      // conversion is exact rather than merely close.
      .eq('public_id', Number(publicId))
      .maybeSingle()

    if (!data) return null
    return { id: data.id, publicId: publicIdToString(data.public_id), projectId: data.project_id }
  },
)

export interface ResolvedRow {
  id: string
  publicId: string
}

/**
 * Resolve a commercial document (a quotation) by its public id.
 *
 * Separate from `resolveDocument` despite the similar name: `documents` are
 * project write-ups and `commercial_documents` are quotations, and conflating
 * the two would let a URL for one address the other.
 */
export const resolveCommercialDoc = cache(
  async (routeParam: string): Promise<ResolvedRow | null> => {
    const publicId = parsePublicId(routeParam)
    if (!publicId) return null

    const supabase = createClient()
    const { data } = await supabase
      .from('commercial_documents')
      .select('id, public_id')
      .eq('public_id', Number(publicId))
      .maybeSingle()

    if (!data) return null
    return { id: data.id, publicId: publicIdToString(data.public_id) }
  },
)

export const resolveWorkflow = cache(async (routeParam: string): Promise<ResolvedRow | null> => {
  const publicId = parsePublicId(routeParam)
  if (!publicId) return null

  const supabase = createClient()
  const { data } = await supabase
    .from('workflows')
    .select('id, public_id')
    .eq('public_id', Number(publicId))
    .maybeSingle()

  if (!data) return null
  return { id: data.id, publicId: publicIdToString(data.public_id) }
})
