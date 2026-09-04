'use server'

import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import {
  COMMERCIAL_DOC_TYPES,
  DEFAULT_PDF_TEMPLATE,
  parsePdfTemplate,
  type CommercialDocType,
} from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * PDF templates (§6.4).
 *
 * `template_data` is jsonb, so the only thing standing between a form post and
 * the renderer is `parsePdfTemplate`. Every write goes through it — the stored
 * blob is always already-validated, which is what lets the renderer treat it as
 * trusted.
 */

interface Scope {
  orgSlug: string
  workspaceSlug: string
}

const templatesPath = (scope: Scope) =>
  `/${scope.orgSlug}/${scope.workspaceSlug}/commercial/templates`

async function assertManager(orgSlug: string) {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) {
    throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', status: 403 })
  }
  return auth
}

function readTemplate(formData: FormData) {
  return parsePdfTemplate({
    accentColor: formData.get('accentColor'),
    textColor: formData.get('textColor'),
    mutedColor: formData.get('mutedColor'),
    fontFamily: formData.get('fontFamily'),
    fontSize: Number(formData.get('fontSize')),
    pageSize: formData.get('pageSize'),
    margin: Number(formData.get('margin')),
    accentBar: formData.get('accentBar') === 'on',
    showLogo: formData.get('showLogo') === 'on',
    headerTitle: formData.get('headerTitle'),
    footerText: formData.get('footerText'),
    columns: formData.getAll('columns'),
    // Unchecked boxes are absent from the payload, so absence means false here
    // — the opposite of the parser's default, which has to assume an older
    // stored blob simply predates the field.
    showNotes: formData.get('showNotes') === 'on',
    showTerms: formData.get('showTerms') === 'on',
    showPaymentSummary: formData.get('showPaymentSummary') === 'on',
  })
}

export async function createTemplate(
  scope: Scope,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await assertManager(scope.orgSlug)

    const name = String(formData.get('name') ?? '').trim()
    if (!name) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Name is required',
        fieldErrors: { name: ['Name is required'] },
      }
    }

    const docType = String(formData.get('doc_type') ?? '')
    if (!(COMMERCIAL_DOC_TYPES as readonly string[]).includes(docType)) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown document type.' }
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('pdf_templates')
      .insert({
        organization_id: auth.orgId,
        doc_type: docType as CommercialDocType,
        name: name.slice(0, 80),
        template_data: { ...DEFAULT_PDF_TEMPLATE },
        // Never default on creation: a partial unique index allows one default
        // per doc type, so claiming it here would fail whenever one exists.
        is_default: false,
      })
      .select('id')
      .single()

    if (error) throw error

    revalidatePath(templatesPath(scope))
    return { ok: true, data: { id: data.id } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function saveTemplate(
  scope: Scope,
  templateId: string,
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const auth = await assertManager(scope.orgSlug)
    const supabase = createClient()

    const name = String(formData.get('name') ?? '').trim()
    if (!name) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Name is required',
        fieldErrors: { name: ['Name is required'] },
      }
    }

    const { error } = await supabase
      .from('pdf_templates')
      .update({
        name: name.slice(0, 80),
        template_data: { ...readTemplate(formData) },
      })
      .eq('id', templateId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(templatesPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Make one template the default for its document type.
 *
 * The old default is cleared first. A partial unique index permits exactly one
 * per (organization, doc_type), so setting the new one without clearing the old
 * would simply fail.
 */
export async function setDefaultTemplate(
  scope: Scope,
  templateId: string,
): Promise<ActionResult<null>> {
  try {
    const auth = await assertManager(scope.orgSlug)
    const supabase = createClient()

    const { data: template } = await supabase
      .from('pdf_templates')
      .select('id, doc_type')
      .eq('id', templateId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!template) return { ok: false, code: 'NOT_FOUND', message: 'Template not found.' }

    await supabase
      .from('pdf_templates')
      .update({ is_default: false })
      .eq('organization_id', auth.orgId)
      .eq('doc_type', template.doc_type)
      .eq('is_default', true)

    const { error } = await supabase
      .from('pdf_templates')
      .update({ is_default: true })
      .eq('id', templateId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(templatesPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteTemplate(
  scope: Scope,
  templateId: string,
): Promise<ActionResult<null>> {
  try {
    const auth = await assertManager(scope.orgSlug)
    const supabase = createClient()

    // Documents referencing this template keep their pdf_template_id only if
    // the FK says so; it is ON DELETE SET NULL, and such a document falls back
    // to the doc-type default. That is why deleting is allowed at all.
    const { error } = await supabase
      .from('pdf_templates')
      .delete()
      .eq('id', templateId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(templatesPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
