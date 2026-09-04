'use server'

import { assertCan } from '@pm/auth/rbac'
import type { CommercialDocType } from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import {
  commercialDocCreateSchema,
  commercialDocUpdateSchema,
  fieldErrors,
  paymentSchema,
  statusSchemaFor,
} from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
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
    // lock — two people creating an invoice at once cannot collide (§18 rule 4).
    const { data: docNumber, error: numberError } = await supabase.rpc('next_doc_number', {
      org: auth.orgId,
      p_doc_type: doc.doc_type,
    })
    if (numberError) throw numberError

    const { data: created, error } = await supabase
      .from('commercial_documents')
      .insert({
        ...doc,
        // A quotation's expiry is the only place valid_until is legal.
        valid_until: doc.doc_type === 'quotation' ? (doc.valid_until ?? null) : null,
        doc_number: docNumber as string,
        organization_id: auth.orgId,
        status: doc.doc_type === 'bill' ? 'received' : 'draft',
        created_by: auth.userId,
      })
      .select('id')
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
    return { ok: true, data: { id: created.id } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateCommercialDoc(
  scope: Scope,
  documentId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'update')

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
      .eq('id', documentId)
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
      .eq('id', documentId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    // Line items are replaced wholesale: the editor sends the full list, and
    // diffing rows the client may have reordered buys nothing here.
    if (line_items !== undefined) {
      await supabase.from('commercial_line_items').delete().eq('document_id', documentId)

      if (line_items.length > 0) {
        const { error: itemsError } = await supabase.from('commercial_line_items').insert(
          line_items.map((item, index) => ({
            document_id: documentId,
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
          .eq('id', documentId)
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
  documentId: string,
  status: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'update')

  const supabase = createClient()

  try {
    const { data: existing } = await supabase
      .from('commercial_documents')
      .select('doc_type')
      .eq('id', documentId)
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

    // Approving is a separate permission from editing (§8).
    if (status === 'approved') {
      assertCan(auth, 'commercial', 'approve')
    }

    const { error } = await supabase
      .from('commercial_documents')
      .update({
        status: parsed.data.status,
        ...(status === 'approved'
          ? { approved_by: auth.userId, approved_at: new Date().toISOString() }
          : {}),
        ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
      })
      .eq('id', documentId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(commercialPath(scope, existing.doc_type))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Record a payment against an invoice or bill.
 *
 * `amount_paid` accumulates and the status follows from the comparison with
 * `grand_total`, so "paid" is always a statement about the numbers rather than
 * an independent flag someone can set.
 */
export async function recordPayment(
  scope: Scope,
  documentId: string,
  amount: number,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'update')

  const parsed = paymentSchema.safeParse({ amount })
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message ?? 'Invalid amount.',
    }
  }

  const supabase = createClient()

  try {
    const { data: doc } = await supabase
      .from('commercial_documents')
      .select('doc_type, amount_paid, grand_total')
      .eq('id', documentId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!doc) return { ok: false, code: 'NOT_FOUND', message: 'Document not found.' }
    if (doc.doc_type !== 'invoice' && doc.doc_type !== 'bill') {
      return {
        ok: false,
        code: 'INVALID_STATUS',
        message: 'Only invoices and bills take payments.',
      }
    }

    const paid = Number(doc.amount_paid) + parsed.data.amount
    const total = Number(doc.grand_total)

    if (paid > total) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: `That is more than the outstanding balance of ${(total - Number(doc.amount_paid)).toFixed(2)}.`,
      }
    }

    const { error } = await supabase
      .from('commercial_documents')
      .update({
        amount_paid: paid,
        status: paid >= total ? 'paid' : 'partially_paid',
      })
      .eq('id', documentId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(commercialPath(scope, doc.doc_type))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Convert an accepted quotation into a draft invoice (§19.2).
 *
 * The invoice is a new document that references the quotation, not a mutation
 * of it: the quotation stays exactly as the customer accepted it, and both are
 * independently auditable.
 */
export async function convertQuotationToInvoice(
  scope: Scope,
  quotationId: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'create')

  const supabase = createClient()

  try {
    const { data: quotation } = await supabase
      .from('commercial_documents')
      .select(
        'id, doc_type, status, workspace_id, project_id, contact_id, currency, notes, terms, pdf_template_id, converted_to_id',
      )
      .eq('id', quotationId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!quotation || quotation.doc_type !== 'quotation') {
      return { ok: false, code: 'NOT_FOUND', message: 'Quotation not found.' }
    }

    if (quotation.status !== 'accepted') {
      return {
        ok: false,
        code: 'INVALID_STATUS',
        message: 'Only an accepted quotation can be converted.',
      }
    }

    // Converting twice would silently bill the customer twice.
    if (quotation.converted_to_id) {
      return {
        ok: false,
        code: 'CONFLICT',
        message: 'This quotation has already been converted.',
      }
    }

    const { data: lineItems } = await supabase
      .from('commercial_line_items')
      .select('description, quantity, unit_price, tax_rate, discount, position')
      .eq('document_id', quotationId)
      .order('position')

    const { data: docNumber, error: numberError } = await supabase.rpc('next_doc_number', {
      org: auth.orgId,
      p_doc_type: 'invoice',
    })
    if (numberError) throw numberError

    const { data: invoice, error } = await supabase
      .from('commercial_documents')
      .insert({
        organization_id: auth.orgId,
        workspace_id: quotation.workspace_id,
        project_id: quotation.project_id,
        doc_type: 'invoice',
        doc_number: docNumber as string,
        contact_id: quotation.contact_id,
        status: 'draft',
        currency: quotation.currency,
        notes: quotation.notes,
        terms: quotation.terms,
        pdf_template_id: quotation.pdf_template_id,
        reference_doc_id: quotation.id,
        created_by: auth.userId,
      })
      .select('id')
      .single()

    if (error) throw error

    if (lineItems?.length) {
      const { error: itemsError } = await supabase.from('commercial_line_items').insert(
        lineItems.map((item, index) => ({
          ...item,
          document_id: invoice.id,
          organization_id: auth.orgId,
          position: index,
          line_total: 0,
        })),
      )
      if (itemsError) throw itemsError
    }

    // Mark the quotation last: if anything above failed, it stays convertible
    // rather than being stranded pointing at a document that does not exist.
    await supabase
      .from('commercial_documents')
      .update({ status: 'converted', converted_to_id: invoice.id })
      .eq('id', quotationId)
      .eq('organization_id', auth.orgId)

    revalidatePath(commercialPath(scope, 'quotation'))
    revalidatePath(commercialPath(scope, 'invoice'))
    return { ok: true, data: { id: invoice.id } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteCommercialDoc(
  scope: Scope,
  documentId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'delete')

  const supabase = createClient()

  try {
    const { data: doc } = await supabase
      .from('commercial_documents')
      .select('doc_type, status')
      .eq('id', documentId)
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
      .eq('id', documentId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(commercialPath(scope, doc.doc_type))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
