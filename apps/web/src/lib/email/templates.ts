import 'server-only'

/**
 * Email templates.
 *
 * Plain string builders rather than React Email: these are three small
 * transactional messages, and every value is escaped here explicitly, so there
 * is no renderer to trust. Any interpolated value MUST go through `esc`.
 */

/** Escape for HTML text and quoted attribute contexts. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Only http/https links are ever emitted into an email. */
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

const STYLES = {
  body: 'margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
  card: 'max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e4e4e7;',
  title: 'margin:0 0 8px;font-size:17px;font-weight:600;color:#18181b;',
  body_text: 'margin:0 0 20px;font-size:14px;line-height:1.6;color:#52525b;',
  button:
    'display:inline-block;background:#6d4aff;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:500;',
  footer: 'margin:24px 0 0;font-size:12px;color:#a1a1aa;',
}

export interface EmailContent {
  subject: string
  html: string
  text: string
}

export function notificationEmail(input: {
  title: string
  body: string | null
  actionUrl: string | null
  actionLabel?: string
  orgName: string
  preferencesUrl: string | null
}): EmailContent {
  const href = input.actionUrl ? safeUrl(input.actionUrl) : null
  const prefsHref = input.preferencesUrl ? safeUrl(input.preferencesUrl) : null
  const label = input.actionLabel ?? 'Open in app'

  const html = `<!doctype html>
<html><body style="${STYLES.body}">
  <div style="${STYLES.card}">
    <p style="${STYLES.title}">${esc(input.title)}</p>
    ${input.body ? `<p style="${STYLES.body_text}">${esc(input.body)}</p>` : ''}
    ${href ? `<p><a href="${esc(href)}" style="${STYLES.button}">${esc(label)}</a></p>` : ''}
    <p style="${STYLES.footer}">
      You are receiving this because of your notification settings in ${esc(input.orgName)}.
      ${prefsHref ? `<a href="${esc(prefsHref)}" style="color:#71717a;">Change them</a>.` : ''}
    </p>
  </div>
</body></html>`

  const text = [
    input.title,
    input.body ?? '',
    href ? `${label}: ${href}` : '',
    '',
    `You are receiving this because of your notification settings in ${input.orgName}.`,
    prefsHref ? `Change them: ${prefsHref}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return { subject: input.title, html, text }
}

export function digestEmail(input: {
  orgName: string
  items: { title: string; body: string | null; url: string | null }[]
  inboxUrl: string | null
}): EmailContent {
  const inboxHref = input.inboxUrl ? safeUrl(input.inboxUrl) : null
  const count = input.items.length

  const rows = input.items
    .map((item) => {
      const href = item.url ? safeUrl(item.url) : null
      const title = href
        ? `<a href="${esc(href)}" style="color:#18181b;text-decoration:none;font-weight:500;">${esc(item.title)}</a>`
        : `<span style="font-weight:500;color:#18181b;">${esc(item.title)}</span>`
      return `<li style="margin:0 0 12px;font-size:14px;line-height:1.5;">
        ${title}
        ${item.body ? `<br><span style="color:#71717a;">${esc(item.body)}</span>` : ''}
      </li>`
    })
    .join('')

  const subject = `${count} update${count === 1 ? '' : 's'} in ${input.orgName}`

  const html = `<!doctype html>
<html><body style="${STYLES.body}">
  <div style="${STYLES.card}">
    <p style="${STYLES.title}">${esc(subject)}</p>
    <ul style="margin:0 0 20px;padding:0 0 0 18px;">${rows}</ul>
    ${inboxHref ? `<p><a href="${esc(inboxHref)}" style="${STYLES.button}">Open inbox</a></p>` : ''}
    <p style="${STYLES.footer}">Digest from ${esc(input.orgName)}.</p>
  </div>
</body></html>`

  const text = [
    subject,
    ...input.items.map((item) => `• ${item.title}${item.body ? ` — ${item.body}` : ''}`),
    inboxHref ? `\nOpen inbox: ${inboxHref}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { subject, html, text }
}
