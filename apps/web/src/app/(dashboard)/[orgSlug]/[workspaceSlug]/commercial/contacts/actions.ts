'use server'

import { assertCan } from '@pm/auth/rbac'
import type { ActionResult } from '@pm/shared/types'
import { contactCreateSchema, contactUpdateSchema, fieldErrors } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/** Clients and vendors (§6.4). Manager-and-above, per the contacts RLS policy. */

interface Scope {
  orgSlug: string
  workspaceSlug: string
}

function contactsPath(scope: Scope) {
  return `/${scope.orgSlug}/${scope.workspaceSlug}/commercial/contacts`
}

function readForm(formData: FormData) {
  const street = String(formData.get('street') ?? '').trim()
  const city = String(formData.get('city') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()

  return {
    type: formData.get('type') || 'client',
    company_name: formData.get('company_name') || null,
    contact_name: formData.get('contact_name'),
    // An empty email field must clear the column, not fail the email check.
    email: String(formData.get('email') ?? '').trim() || null,
    phone: formData.get('phone') || null,
    tax_id: formData.get('tax_id') || null,
    notes: formData.get('notes') || null,
    address: street || city || country ? { street, city, country } : null,
  }
}

export async function saveContact(
  scope: Scope,
  contactId: string | null,
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', contactId ? 'update' : 'create')

  const input = readForm(formData)
  const parsed = contactId
    ? contactUpdateSchema.safeParse(input)
    : contactCreateSchema.safeParse(input)

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
    // The schema allows '' for email so a cleared field validates; normalise it
    // to NULL so the column holds one representation of "no email".
    const payload = { ...parsed.data, email: parsed.data.email || null }

    if (contactId) {
      const { error } = await supabase
        .from('contacts')
        .update(payload)
        .eq('id', contactId)
        .eq('organization_id', auth.orgId)
      if (error) throw error
      revalidatePath(contactsPath(scope))
      return { ok: true, data: { id: contactId } }
    }

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        ...payload,
        contact_name: payload.contact_name as string,
        type: payload.type as 'client' | 'vendor' | 'both',
        organization_id: auth.orgId,
        created_by: auth.userId,
      })
      .select('id')
      .single()

    if (error) throw error

    revalidatePath(contactsPath(scope))
    return { ok: true, data: { id: data.id } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteContact(
  scope: Scope,
  contactId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'commercial', 'delete')

  const supabase = createClient()

  try {
    // contact_id is ON DELETE SET NULL, so deleting would silently orphan the
    // documents rather than fail. Refuse instead: an invoice with no contact is
    // a record nobody can act on.
    const { count } = await supabase
      .from('commercial_documents')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contactId)

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        code: 'CONFLICT',
        message: `This contact is on ${count} document${count === 1 ? '' : 's'} and cannot be deleted.`,
      }
    }

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(contactsPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
