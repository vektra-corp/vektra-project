import { redirect } from 'next/navigation'

/**
 * Send the caller to the 403 page.
 *
 * Next 14 has no `forbidden()` primitive (it arrives in 15), so a redirect is
 * the honest equivalent. Typed as `never` so TypeScript narrows correctly after
 * a call, the same way `notFound()` does.
 */
export function forbidden(): never {
  redirect('/403')
}
