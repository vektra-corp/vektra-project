import 'server-only'

import { Resend } from 'resend'
import { isUndeliverable } from './address'

/**
 * Resend client (§3).
 *
 * Constructed lazily so a build or a test run without RESEND_API_KEY does not
 * fail at import time — only an actual send needs the key.
 */
let client: Resend | null = null

export function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!client) client = new Resend(process.env.RESEND_API_KEY)
  return client
}

/** Sender identity. DKIM/SPF/DMARC live on this domain (§3). */
export function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? 'Project Management <notifications@example.com>'
}

export interface SendResult {
  ok: boolean
  skipped?: 'no_api_key' | 'undeliverable_domain'
  error?: string
}

export async function sendEmail(input: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<SendResult> {
  // Checked before the key so a fixture address is refused even in an
  // environment that is fully configured.
  if (isUndeliverable(input.to)) {
    return { ok: false, skipped: 'undeliverable_domain' }
  }

  const resend = getResend()
  // Without a key, a deploy that has not configured email yet degrades to
  // in-app notifications only rather than erroring on every job run.
  if (!resend) return { ok: false, skipped: 'no_api_key' }

  const { error } = await resend.emails.send({
    from: fromAddress(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
