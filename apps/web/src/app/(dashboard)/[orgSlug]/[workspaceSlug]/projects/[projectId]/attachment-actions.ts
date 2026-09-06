'use server'

import { assertCan } from '@pm/auth/rbac'
import { incrementUsage } from '@pm/db'
import { SIGNED_URL_TTL_SECONDS, attachmentPath, validateUpload } from '@pm/shared'
import { limitFor } from '@pm/shared/billing'
import { appError } from '@pm/shared/errors'
import { sanitizeFileName } from '@pm/shared/sanitize'
import type { ActionResult } from '@pm/shared/types'
import { SNIFF_BYTES, checkSniffedType, extensionOf } from '@pm/shared/utils'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Attachment upload and access (claude.md §13.9).
 *
 * The file itself is uploaded from the browser straight to Supabase Storage,
 * but only after this action has checked the plan, validated the file and
 * issued a signed upload token for one specific path. The client never chooses
 * its own storage path, so it cannot write outside its tenant prefix.
 */

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

/**
 * Authorize an upload and hand back a one-shot signed URL.
 *
 * Returns the storage path too, because the client must echo it back to
 * `recordAttachment` — it is not free to invent one.
 */
export async function createUploadUrl(
  scope: Scope,
  taskId: string,
  file: { name: string; size: number; type: string },
): Promise<ActionResult<{ path: string; token: string; fileId: string; fileName: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const supabase = createClient()

  // Only issue an upload URL for a task the caller can actually reach. RLS
  // returns nothing for a task in another tenant, so this doubles as the
  // tenancy check — without it, any task id would mint a valid signed URL.
  const { data: task } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .maybeSingle()

  if (!task) {
    return { ok: false, code: 'NOT_FOUND', message: 'Task not found' }
  }

  // Both ceilings come from the resolved entitlements rather than from a plan
  // name or from usage_counters.limit_value, so a custom plan is honoured and a
  // tampered counter cannot widen them.
  const verdict = validateUpload(file, limitFor(auth.entitlements, 'max_file_size_bytes'))
  if (!verdict.ok) {
    return { ok: false, code: verdict.code, message: verdict.message }
  }

  // Storage quota is metered per org (§17). The ceiling is the plan's; only the
  // running total comes from the counter.
  const { data: usage } = await supabase
    .from('usage_counters')
    .select('current_value')
    .eq('organization_id', auth.orgId)
    .eq('metric', 'storage_bytes')
    .maybeSingle()

  const storageLimit = limitFor(auth.entitlements, 'storage_bytes')
  if (storageLimit !== null && (usage?.current_value ?? 0) + file.size > storageLimit) {
    return {
      ok: false,
      code: 'PLAN_LIMIT',
      message: 'Storage limit reached for your plan',
    }
  }

  const fileId = crypto.randomUUID()
  const fileName = sanitizeFileName(file.name)
  const path = attachmentPath(auth.orgId, fileId, fileName)

  const { data, error } = await supabase.storage.from('attachments').createSignedUploadUrl(path)

  if (error || !data) {
    throw appError('INTERNAL_ERROR', error?.message ?? 'Could not create upload URL')
  }

  return { ok: true, data: { path, token: data.token, fileId, fileName } }
}

/**
 * Record an attachment after the bytes have landed.
 *
 * The path is re-derived from the caller's own org id rather than trusted, so a
 * tampered path cannot attach another tenant's file to this task.
 */
export async function recordAttachment(
  scope: Scope,
  taskId: string,
  input: { fileId: string; fileName: string; size: number; mimeType: string },
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const supabase = createClient()
  const safeName = sanitizeFileName(input.fileName)
  const path = attachmentPath(auth.orgId, input.fileId, safeName)

  /*
   * Sniff the stored bytes before the file becomes an attachment (§13.9).
   *
   * Uploads go straight to storage through a signed URL, so the server never
   * sees them on the way in — the declared MIME type and the extension are both
   * just strings the client chose. This is the first point at which the actual
   * content can be examined, and it is still before anything references the
   * object: no attachment row exists yet, so a file that fails here is deleted
   * and was never reachable.
   *
   * Only the first bytes are fetched, not the whole file.
   */
  const { data: head, error: readError } = await supabase.storage
    .from('attachments')
    .download(path)

  if (readError || !head) {
    return { ok: false, code: 'NOT_FOUND', message: 'The uploaded file could not be read.' }
  }

  const prefix = new Uint8Array(await head.slice(0, SNIFF_BYTES).arrayBuffer())
  const verdict = checkSniffedType(prefix, input.mimeType, extensionOf(safeName))

  if (!verdict.ok) {
    // Remove it rather than leaving an unreferenced object behind: it would
    // count against the org's storage quota and nothing would ever clean it up.
    await supabase.storage.from('attachments').remove([path])
    return { ok: false, code: 'UNSUPPORTED_FILE_TYPE', message: verdict.reason }
  }

  const { error } = await supabase.from('attachments').insert({
    organization_id: auth.orgId,
    task_id: taskId,
    file_name: safeName,
    file_size: input.size,
    // The sniffed type, not the declared one — what is stored should be what
    // the file actually is, because every later consumer trusts this column.
    mime_type: verdict.mime,
    storage_path: path,
    uploaded_by: auth.userId,
  })

  if (error) {
    // Orphaned object: the row failed, so the bytes must not linger.
    await supabase.storage.from('attachments').remove([path])
    return { ok: false, code: 'INTERNAL_ERROR', message: error.message }
  }

  await incrementUsage(supabase, 'storage_bytes', input.size)

  revalidatePath(`/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}`)
  return { ok: true, data: null }
}

/**
 * Signed download link.
 *
 * Files are never served from a public URL (business rule 9); every access goes
 * through a short-lived signed URL, which keeps storage access aligned with RLS.
 */
export async function getAttachmentUrl(
  scope: Scope,
  attachmentId: string,
): Promise<ActionResult<{ url: string }>> {
  // Called for the access check; RLS decides row visibility below.
  await requireAuth(scope.orgSlug)
  const supabase = createClient()

  const { data: attachment } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .maybeSingle()

  if (!attachment) return { ok: false, code: 'NOT_FOUND', message: 'Attachment not found' }

  const { data, error } = await supabase.storage
    .from('attachments')
    .createSignedUrl(attachment.storage_path, SIGNED_URL_TTL_SECONDS)

  if (error || !data) {
    return { ok: false, code: 'INTERNAL_ERROR', message: error?.message ?? 'Could not sign URL' }
  }

  return { ok: true, data: { url: data.signedUrl } }
}

export async function deleteAttachment(
  scope: Scope,
  attachmentId: string,
): Promise<ActionResult<null>> {
  // Called for the gate, not for a value: it establishes the session and the
  // tenant before any query runs. Deletion is then scoped by RLS.
  await requireAuth(scope.orgSlug)
  const supabase = createClient()

  const { data: attachment } = await supabase
    .from('attachments')
    .select('storage_path, file_size')
    .eq('id', attachmentId)
    .maybeSingle()

  if (!attachment) return { ok: false, code: 'NOT_FOUND', message: 'Attachment not found' }

  // RLS allows only the uploader or a manager to delete.
  const { error } = await supabase.from('attachments').delete().eq('id', attachmentId)
  if (error) return { ok: false, code: 'FORBIDDEN', message: 'Not permitted' }

  await supabase.storage.from('attachments').remove([attachment.storage_path])
  await incrementUsage(supabase, 'storage_bytes', -attachment.file_size)

  revalidatePath(`/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}`)
  return { ok: true, data: null }
}
