'use server'

import { assertCan } from '@pm/auth/rbac'
import { sanitizeTiptapJson } from '@pm/shared/sanitize'
import type { ActionResult } from '@pm/shared/types'
import { publicIdToString } from '@pm/shared/utils'
import { documentCreateSchema, documentUpdateSchema, fieldErrors } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { resolveDocument, resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

/**
 * Project documents (§6.3).
 *
 * Bodies are sanitized here, server-side, BEFORE storage (§13.1) — so every
 * later reader of the row inherits the guarantee rather than re-sanitizing on
 * render. Version history is the database's job: the `snapshot_document_version`
 * trigger records the previous body on every content change, so no action here
 * writes to `document_versions` directly.
 */

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

/**
 * The uuid behind a scope, or a failure the caller can return as-is.
 *
 * `scope.projectId` is the 16-digit public id the URL carried; foreign keys are
 * uuids. Resolving here also makes the project's existence and visibility a
 * precondition of the write.
 */
async function projectUuid(
  scope: Scope,
): Promise<{ ok: true; id: string } | { ok: false; error: ActionResult<never> }> {
  const project = await resolveProject(scope.projectId)
  if (!project) {
    return {
      ok: false,
      error: { ok: false, code: 'NOT_FOUND', message: 'That project was not found.' },
    }
  }
  return { ok: true, id: project.id }
}

function documentsPath(scope: Scope) {
  return `/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/documents`
}

/** The composer posts Tiptap JSON; an empty body is a valid empty document. */
function parseContent(raw: FormDataEntryValue | null): unknown {
  const text = String(raw ?? '').trim()
  if (!text) return { type: 'doc', content: [] }
  try {
    return JSON.parse(text)
  } catch {
    // A body that is not JSON means the editor never hydrated. Keep the text
    // rather than discarding what someone typed.
    return {
      type: 'doc',
      content: text.split(/\n{2,}/).map((paragraph) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: paragraph }],
      })),
    }
  }
}

/**
 * The uuid behind a document's public id, or a failure to return as-is.
 *
 * Documents are addressed by their 16-digit public id in the URL, so an action
 * receives that and not the primary key — and the revalidated path below has to
 * be the public one or it matches no route.
 */
async function documentUuid(
  publicId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: ActionResult<never> }> {
  const document = await resolveDocument(publicId)
  if (!document) {
    return {
      ok: false,
      error: { ok: false, code: 'NOT_FOUND', message: 'That document was not found.' },
    }
  }
  return { ok: true, id: document.id }
}

export async function createDocument(
  scope: Scope,
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  // A document is project content, so it follows the project's write permission
  // rather than introducing a separate module to the matrix.
  assertCan(auth, 'tasks', 'create')

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const parsed = documentCreateSchema.safeParse({
    project_id: project.id,
    title: formData.get('title'),
    content: parseContent(formData.get('content')),
    status: formData.get('status') || 'draft',
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const supabase = createClient()

  try {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        project_id: project.id,
        organization_id: auth.orgId,
        title: parsed.data.title,
        content: sanitizeTiptapJson(parsed.data.content) as never,
        status: parsed.data.status,
        created_by: auth.userId,
      })
      // The dialog navigates straight to the new document, so it needs the id
      // the URL uses, not the primary key.
      .select('public_id')
      .single()

    if (error) throw error

    revalidatePath(documentsPath(scope))
    return { ok: true, data: { id: publicIdToString(data.public_id) } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateDocument(
  scope: Scope,
  documentPublicId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const document = await documentUuid(documentPublicId)
  if (!document.ok) return document.error

  const hasContent = formData.has('content')

  const parsed = documentUpdateSchema.safeParse({
    title: formData.get('title') ?? undefined,
    // Only touch content when the form actually carried it: a title-only save
    // must not bump the version by rewriting an identical body.
    ...(hasContent ? { content: parseContent(formData.get('content')) } : {}),
    status: formData.get('status') ?? undefined,
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const supabase = createClient()

  try {
    const { content, ...patch } = parsed.data

    const { error } = await supabase
      .from('documents')
      .update({
        ...patch,
        ...(content !== undefined
          ? { content: sanitizeTiptapJson(content) as never }
          : {}),
      })
      .eq('id', document.id)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(documentsPath(scope))
    revalidatePath(`${documentsPath(scope)}/${documentPublicId}`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Restore an earlier version.
 *
 * Written as an ordinary content update rather than a rewrite of `version`, so
 * the snapshot trigger captures the state being replaced. History stays
 * append-only: restoring v2 over v5 produces a v6 whose body is v2's.
 */
export async function restoreDocumentVersion(
  scope: Scope,
  documentPublicId: string,
  version: number,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const document = await documentUuid(documentPublicId)
  if (!document.ok) return document.error

  const supabase = createClient()

  try {
    const { data: snapshot } = await supabase
      .from('document_versions')
      .select('content')
      .eq('document_id', document.id)
      .eq('version', version)
      .maybeSingle()

    if (!snapshot) {
      return { ok: false, code: 'NOT_FOUND', message: 'That version no longer exists.' }
    }

    const { error } = await supabase
      .from('documents')
      .update({ content: sanitizeTiptapJson(snapshot.content) as never })
      .eq('id', document.id)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(`${documentsPath(scope)}/${documentPublicId}`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteDocument(
  scope: Scope,
  documentPublicId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  // Deleting takes the version history with it, so it needs delete rights
  // rather than the update rights that cover archiving.
  assertCan(auth, 'tasks', 'delete')

  const document = await documentUuid(documentPublicId)
  if (!document.ok) return document.error

  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', document.id)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(documentsPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
