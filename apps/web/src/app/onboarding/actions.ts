'use server'

import { appError } from '@pm/shared/errors'
import type { ActionResult } from '@pm/shared/types'
import { fieldErrors, organizationCreateSchema } from '@pm/shared/validators'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Create the caller's first organization.
 *
 * The insert happens inside the create_organization RPC so the org, the owner
 * membership and the default workspace are written in one transaction — a
 * partial failure would otherwise leave an organization nobody can open.
 */
export async function createOrganization(
  _prevState: ActionResult<{ slug: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ slug: string }>> {
  const parsed = organizationCreateSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    currency: formData.get('currency') || 'USD',
    timezone: formData.get('timezone') || 'UTC',
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

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw appError('UNAUTHORIZED', 'Not signed in')

  const { error } = await supabase.rpc('create_organization', {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_timezone: parsed.data.timezone,
    p_currency: parsed.data.currency,
  })

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        code: 'ALREADY_EXISTS',
        message: 'onboarding.slug_taken',
        fieldErrors: { slug: ['onboarding.slug_taken'] },
      }
    }
    return { ok: false, code: 'INTERNAL_ERROR', message: error.message }
  }

  // The JWT still carries no org_id claim. Refreshing runs
  // custom_access_token_hook again so RLS sees the new tenant (business rule 10).
  await supabase.auth.refreshSession()

  redirect(`/${parsed.data.slug}/dashboard`)
}

/** Live availability check for the slug field. */
export async function checkSlugAvailable(slug: string): Promise<boolean> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('slug_available', { p_slug: slug })
  if (error) return false
  return data === true
}
