'use server'

import { assertCan } from '@pm/auth/rbac'
import type { CommercialDocType } from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { publicIdToString } from '@pm/shared/utils'
import {
  commercialDocCreateSchema,
  commercialDocUpdateSchema,
  fieldErrors,
  statusSchemaFor,
} from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { resolveCommercialDoc } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

/**
 * Commercial documents (§6.4, §19.2).
 *
 * Money is never written from here. `line_total` is set by a BEFORE trigger and
 * the four document totals by an AFTER trigger, both SECURITY DEFINER, with the
 * columns revoked from end-user roles — so the arithmetic a client submits
 * cannot become the arithmetic that is stored.
 */

interface Scope {
  orgSlug: string
  workspaceSlug: string
}

function commercialPath(scope: Scope, docType?: string) {
  const base = `/${scope.orgSlug}/${scope.workspaceSlug}/commercial`
  return docType ? `${base}/${docType}` : base
}

/**
 * The uuid behind a quotation's public id, or a failure to return as-is.
 *
 * Routes address a document by its 16-digit public id, so every action here
 * receives that rather than the primary key.
 */
async function documentUuid(
  publicId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: ActionResult<never> }> {
  const doc = await resolveCommercialDoc(publicId)
  if (!doc) {
    return {
      ok: false,
      error: { ok: false, code: 'NOT_FOUND', message: 'Document not found.' },
    }
  }
  return { ok: true, id: doc.id }
}

function parseLineItems(raw: FormDataEntryValue | null): unknown[] {
  const text = String(raw ?? '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function createCommercialDoc(
  scope: Scope,
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'create')

  const parsed = commercialDocCreateSchema.safeParse({
    doc_type: formData.get('doc_type'),
    workspace_id: formData.get('workspace_id'),
    project_id: formData.get('project_id') || null,
    contact_id: formData.get('contact_id') || null,
    issue_date: formData.get('issue_date'),
    due_date: formData.get('due_date') || null,
    valid_until: formData.get('valid_until') || null,
    currency: formData.get('currency') || auth.orgCurrency,
    notes: formData.get('notes') || null,
    terms: formData.get('terms') || null,
    line_items: parseLineItems(formData.get('line_items')),
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
    const { line_items, ...doc } = parsed.data

    // The number comes from next_doc_number(), which increments under a row
    // lock — two people creating a quotation at once cannot collide (§18 rule 4).
    const { data: docNumber, error: numberError } = await supabase.rpc('next_doc_number', {
      org: auth.orgId,
      p_doc_type: doc.doc_type,
    })
    if (numberError) throw numberError

    const { data: created, error } = await supabase
      .from('commercial_documents')
      .insert({
        ...doc,
        valid_until: doc.valid_until ?? null,
        doc_number: docNumber as string,
        organization_id: auth.orgId,
        status: 'draft',
        created_by: auth.userId,
      })
      // The form navigates straight to the new document, so it needs the id
      // the URL uses, not the primary key.
      .select('id, public_id')
      .single()

    if (error) throw error

    if (line_items.length > 0) {
      const { error: itemsError } = await supabase.from('commercial_line_items').insert(
        line_items.map((item, index) => ({
          document_id: created.id,
          organization_id: auth.orgId,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          tax_rate: item.tax_rate,
          discount: item.discount,
          position: index,
          // Required by the column, immediately overwritten by set_line_total.
          line_total: 0,
        })),
      )
      if (itemsError) throw itemsError
    }

    revalidatePath(commercialPath(scope, doc.doc_type))
    return { ok: true, data: { id: publicIdToString(created.public_id) } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateCommercialDoc(
  scope: Scope,
  documentPublicId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'update')

  const document = await documentUuid(documentPublicId)
  if (!document.ok) return document.error

  const parsed = commercialDocUpdateSchema.safeParse({
    project_id: formData.get('project_id') || null,
    contact_id: formData.get('contact_id') || null,
    issue_date: formData.get('issue_date') ?? undefined,
    due_date: formData.get('due_date') || null,
    valid_until: formData.get('valid_until') || null,
    currency: formData.get('currency') ?? undefined,
    notes: formData.get('notes') || null,
    terms: formData.get('terms') || null,
    line_items: parseLineItems(formData.get('line_items')),
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
    const { data: existing } = await supabase
      .from('commercial_documents')
      .select('doc_type, status')
      .eq('id', document.id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Document not found.' }

    // Once a document has left draft it is a record of something that was sent
    // or agreed. Editing it would rewrite history the other party already has.
    const editableStatuses = ['draft', 'received', 'pending_approval']
    if (!editableStatuses.includes(existing.status)) {
      return {
        ok: false,
        code: 'INVALID_STATUS',
        message: `A ${existing.status.replace('_', ' ')} document cannot be edited.`,
      }
    }

    const { line_items, ...patch } = parsed.data

    const { error } = await supabase
      .from('commercial_documents')
      .update({
        ...patch,
        valid_until: existing.doc_type === 'quotation' ? (patch.valid_until ?? null) : null,
      })
      .eq('id', document.id)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    // Line items are replaced wholesale: the editor sends the full list, and
    // diffing rows the client may have reordered buys nothing here.
    if (line_items !== undefined) {
      await supabase.from('commercial_line_items').delete().eq('document_id', document.id)

      if (line_items.length > 0) {
        const { error: itemsError } = await supabase.from('commercial_line_items').insert(
          line_items.map((item, index) => ({
            document_id: document.id,
            organization_id: auth.orgId,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            tax_rate: item.tax_rate,
            discount: item.discount,
            position: index,
            line_total: 0,
          })),
        )
        if (itemsError) throw itemsError
      } else {
        // Deleting the last line leaves no row for the AFTER trigger to fire
        // on, so the totals would keep their stale values. Zero them here.
        await supabase
          .from('commercial_documents')
          .update({ subtotal: 0, tax_total: 0, discount_total: 0, grand_total: 0 })
          .eq('id', document.id)
      }
    }

    revalidatePath(commercialPath(scope, existing.doc_type))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function setCommercialStatus(
  scope: Scope,
  documentPublicId: string,
  status: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'update')

  const document = await documentUuid(documentPublicId)
  if (!document.ok) return document.error

  const supabase = createClient()

  try {
    const { data: existing } = await supabase
      .from('commercial_documents')
      .select('doc_type')
      .eq('id', document.id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Document not found.' }

    const parsed = statusSchemaFor(existing.doc_type as CommercialDocType).safeParse({ status })
    if (!parsed.success) {
      return {
        ok: false,
        code: 'INVALID_STATUS',
        message: parsed.error.issues[0]?.message ?? 'Invalid status.',
      }
    }

    // There is no approval step left to guard: 'approved' belonged to purchase
    // orders and bills, and `statusSchemaFor` now refuses it outright.
    const { error } = await supabase
      .from('commercial_documents')
      .update({
        status: parsed.data.status,
        ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
      })
      .eq('id', document.id)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(commercialPath(scope, existing.doc_type))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}


export async function deleteCommercialDoc(
  scope: Scope,
  documentPublicId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'delete')

  const document = await documentUuid(documentPublicId)
  if (!document.ok) return document.error

  const supabase = createClient()

  try {
    const { data: doc } = await supabase
      .from('commercial_documents')
      .select('doc_type, status')
      .eq('id', document.id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!doc) return { ok: false, code: 'NOT_FOUND', message: 'Document not found.' }

    // §18 rule 4: a number is never recycled. Anything that has been issued is
    // voided or closed, never deleted, so the sequence stays a complete record.
    if (doc.status !== 'draft' && doc.status !== 'received') {
      return {
        ok: false,
        code: 'INVALID_STATUS',
        message: 'Only a draft can be deleted. Void or close this instead.',
      }
    }

    const { error } = await supabase
      .from('commercial_documents')
      .delete()
      .eq('id', document.id)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(commercialPath(scope, doc.doc_type))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Create or update, behind one signature.
 *
 * The form binds this once rather than switching between two actions with
 * different success payloads — which otherwise forces a cast at the call site
 * for no gain. Both paths return the document's id so the caller can navigate.
 */
export async function saveCommercialDoc(
  scope: Scope,
  documentId: string | null,
  prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  if (!documentId) return createCommercialDoc(scope, prevState, formData)

  const result = await updateCommercialDoc(scope, documentId, null, formData)
  return result.ok ? { ok: true, data: { id: documentId } } : result
}
