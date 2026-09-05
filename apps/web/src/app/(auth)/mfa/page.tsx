import type { Metadata } from 'next'
import { MfaChallengeForm } from './mfa-form'

export const metadata: Metadata = { title: 'Two-step verification' }

/**
 * The second-factor prompt (§13.5).
 *
 * Reached only by the middleware redirect, which is also what stops anyone
 * simply navigating past it.
 */
export default function MfaPage({ searchParams }: { searchParams: { next?: string } }) {
  return <MfaChallengeForm next={searchParams.next} />
}
