import type { ActionResult } from '@pm/shared/types'

/**
 * Turn a thrown error into a form-renderable failure.
 *
 * §16: internal detail never reaches the client as a code. An AppError carries a
 * stable code the UI can translate; anything else collapses to INTERNAL_ERROR so
 * a Postgres constraint name or a stack frame cannot leak through a form.
 */
export function toActionError(error: unknown): ActionResult<never> {
  const code = (error as { code?: string })?.code
  const message = error instanceof Error ? error.message : 'Something went wrong'
  return {
    ok: false,
    code: typeof code === 'string' ? code : 'INTERNAL_ERROR',
    message,
  }
}
