'use server'

import { assertCan } from '@pm/auth/rbac'
import {
  SIGNED_URL_TTL_SECONDS,
  attachmentPath,
  validateUpload,
  type PlanName,
} from '@pm/shared'
import { appError } from '@pm/shared/errors'
import { sanitizeFileName } from '@pm/shared/sanitize'
import type { ActionResult } from '@pm/shared/types'
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

async function planFor(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
): Promise<PlanName> {
  const { data } = await supabase
    .from('organizations')
    .select('plan:plans(name)')
    .eq('id', orgId)
    .maybeSingle()

  const plan = Array.isArray(data?.plan) ? data?.plan[0] : data?.plan
  return (plan?.name ?? 'starter') as PlanName
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
  const plan = await planFor(supabase, auth.orgId)

  const verdict = validateUpload(file, plan)
  if (!verdict.ok) {
    return { ok: false, code: verdict.code, message: verdict.message }
  }

  // Storage quota is metered per org (§17).
  const { data: usage } = await supabase
    .from('usage_counters')
    .select('current_value, limit_value')
    .eq('organization_id', auth.orgId)
    .eq('metric', 'storage_bytes')
    .maybeSingle()

  // No counter row yet means nothing has been uploaded; a null limit is
  // unlimited. Only an explicit numeric ceiling can reject the upload.
  const storageLimit = usage?.limit_value ?? null
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

  const { error } = await supabase.from('attachments').insert({
    organization_id: auth.orgId,
    task_id: taskId,
    file_name: safeName,
    file_size: input.size,
    mime_type: input.mimeType,
    storage_path: path,
    uploaded_by: auth.userId,
  })

  if (error) {
    // Orphaned object: the row failed, so the bytes must not linger.
    await supabase.storage.from('attachments').remove([path])
    return { ok: false, code: 'INTERNAL_ERROR', message: error.message }
  }

  await supabase.rpc('increment_usage', {
    org: auth.orgId,
    p_metric: 'storage_bytes',
    p_delta: input.size,
  })

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
  const auth = await requireAuth(scope.orgSlug)
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
  await supabase.rpc('increment_usage', {
    org: auth.orgId,
    p_metric: 'storage_bytes',
    p_delta: -attachment.file_size,
  })

  revalidatePath(`/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}`)
  return { ok: true, data: null }
}
