'use server'

import type { ActionResult } from '@pm/shared/types'
import { fieldErrors, resetPasswordSchema } from '@pm/shared/validators'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Finish accepting an invitation by choosing a password.
 *
 * Reached only with a session already established: the invite link went through
 * `/auth/callback`, which exchanged it for one. So this does not verify
 * anything — it sets the password of whoever the session belongs to, exactly as
 * the recovery flow does.
 *
 * Setting a password is the point of the whole screen. An invited account is
 * created without one, so until this runs the only way into it is a single link
 * that expires; someone who skipped this step would be locked out the next day
 * with no way to reset, because a reset needs a password to replace.
 */
export async function acceptInvite(
  orgSlug: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm_password: formData.get('confirm_password'),
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

  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'That invitation link has expired. Ask for a new one.',
    }
  }

  const fullName = String(formData.get('full_name') ?? '').trim().slice(0, 150)

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    return { ok: false, code: 'INTERNAL_ERROR', message: error.message }
  }

  // The profile row is created by a trigger on signup with whatever name the
  // account had, which for an invited account is nothing. Filling it in here
  // means the person is not a blank avatar on every task they touch.
  if (fullName) {
    await supabase.from('profiles').update({ full_name: fullName }).eq('id', user.id)
  }

  // Straight into the organization they were invited to. The JWT minted by the
  // link already carries its org_id claim, because the membership row was
  // written before the invitation was sent.
  redirect(orgSlug ? `/${orgSlug}/dashboard` : '/')
}
