import 'server-only'

import { Resend } from 'resend'

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
  skipped?: 'no_api_key'
  error?: string
}

/**
 * Send one transactional email.
 *
 * Returns a result rather than throwing: the caller is a background job
 * processing a batch, and one bad address must not abort the rest.
 */
export async function sendEmail(input: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<SendResult> {
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
