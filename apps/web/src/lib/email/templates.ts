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
  list: 'margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.7;color:#52525b;',
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

/**
 * Invitation to join an organization.
 *
 * Sent by the app rather than by Supabase Auth. `generateLink` mints the link
 * without sending anything, which is what makes this possible — and it is worth
 * the extra step, because Supabase's stock invite mail can say only "you have
 * been invited", with no idea who invited you, to what, or as what. Those three
 * facts are the whole content of the decision the reader has to make.
 */
/**
 * The "and here is what you can open" line.
 *
 * Returned as a pair so the HTML and the text part stay in step; an empty list
 * yields empty strings rather than a dangling "Projects:" heading.
 */
function projectLines(projectNames: string[]): { html: string; text: string } {
  if (projectNames.length === 0) return { html: '', text: '' }
  const items = projectNames.map((name) => `<li>${esc(name)}</li>`).join('')
  return {
    html: `<p style="${STYLES.body_text}">You have been added to:</p><ul style="${STYLES.list}">${items}</ul>`,
    text: `You have been added to:\n${projectNames.map((name) => `- ${name}`).join('\n')}`,
  }
}

export function inviteEmail(input: {
  orgName: string
  inviterName: string | null
  role: string
  acceptUrl: string
  projectNames?: string[]
}): EmailContent {
  const href = safeUrl(input.acceptUrl)
  const projects = projectLines(input.projectNames ?? [])
  const subject = `${input.inviterName ?? 'Someone'} invited you to ${input.orgName}`
  const intro = input.inviterName
    ? `${input.inviterName} has invited you to join ${input.orgName} on Vektra Project as a ${input.role}.`
    : `You have been invited to join ${input.orgName} on Vektra Project as a ${input.role}.`

  const html = `<!doctype html>
<html><body style="${STYLES.body}">
  <div style="${STYLES.card}">
    <p style="${STYLES.title}">Join ${esc(input.orgName)}</p>
    <p style="${STYLES.body_text}">${esc(intro)}</p>
    ${projects.html}
    ${href ? `<p><a href="${esc(href)}" style="${STYLES.button}">Accept the invitation</a></p>` : ''}
    <p style="${STYLES.footer}">
      You will choose a password on the next screen. The link expires in 24 hours.
      If you were not expecting this, you can ignore this email.
    </p>
  </div>
</body></html>`

  const text = [
    `Join ${input.orgName}`,
    intro,
    projects.text,
    href ? `Accept the invitation: ${href}` : '',
    '',
    'You will choose a password on the next screen. The link expires in 24 hours.',
    'If you were not expecting this, you can ignore this email.',
  ]
    .filter(Boolean)
    .join('\n\n')

  return { subject, html, text }
}

/**
 * Someone with an existing account has been added to another organization.
 *
 * A different message from an invitation on purpose: there is nothing to accept
 * and no password to set — they already have both — so offering an "accept"
 * button would be inviting them to do something that has already happened.
 */
export function addedToOrgEmail(input: {
  orgName: string
  inviterName: string | null
  role: string
  orgUrl: string
  projectNames?: string[]
}): EmailContent {
  const href = safeUrl(input.orgUrl)
  const projects = projectLines(input.projectNames ?? [])
  const subject = `You now have access to ${input.orgName}`
  const intro = input.inviterName
    ? `${input.inviterName} added you to ${input.orgName} on Vektra Project as a ${input.role}.`
    : `You have been added to ${input.orgName} on Vektra Project as a ${input.role}.`

  const html = `<!doctype html>
<html><body style="${STYLES.body}">
  <div style="${STYLES.card}">
    <p style="${STYLES.title}">${esc(input.orgName)}</p>
    <p style="${STYLES.body_text}">${esc(intro)} Sign in with your existing account to open it.</p>
    ${projects.html}
    ${href ? `<p><a href="${esc(href)}" style="${STYLES.button}">Open ${esc(input.orgName)}</a></p>` : ''}
    <p style="${STYLES.footer}">You can switch between organizations from the sidebar.</p>
  </div>
</body></html>`

  const text = [
    subject,
    `${intro} Sign in with your existing account to open it.`,
    projects.text,
    href ? `Open ${input.orgName}: ${href}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return { subject, html, text }
}

/**
 * An existing member has been given access to one or more projects.
 *
 * Distinct from `addedToOrgEmail`: the reader is already in the organization and
 * already signed in, so the message is about the projects themselves rather
 * than about joining anything. It links straight to the first project — the one
 * thing they most likely want to open — rather than to the dashboard.
 */
export function addedToProjectsEmail(input: {
  orgName: string
  actorName: string | null
  projectNames: string[]
  projectUrl: string | null
}): EmailContent {
  const href = input.projectUrl ? safeUrl(input.projectUrl) : null
  const many = input.projectNames.length > 1
  const subject = many
    ? `You were added to ${input.projectNames.length} projects in ${input.orgName}`
    : `You were added to ${input.projectNames[0] ?? 'a project'}`

  const intro = input.actorName
    ? `${input.actorName} gave you access to ${many ? 'these projects' : 'this project'} in ${input.orgName}.`
    : `You were given access to ${many ? 'these projects' : 'this project'} in ${input.orgName}.`

  const items = input.projectNames.map((name) => `<li>${esc(name)}</li>`).join('')

  const html = `<!doctype html>
<html><body style="${STYLES.body}">
  <div style="${STYLES.card}">
    <p style="${STYLES.title}">${esc(many ? input.orgName : (input.projectNames[0] ?? input.orgName))}</p>
    <p style="${STYLES.body_text}">${esc(intro)}</p>
    <ul style="${STYLES.list}">${items}</ul>
    ${href ? `<p><a href="${esc(href)}" style="${STYLES.button}">Open ${esc(many ? input.orgName : (input.projectNames[0] ?? 'project'))}</a></p>` : ''}
    <p style="${STYLES.footer}">You can turn these emails off per project from its notification settings.</p>
  </div>
</body></html>`

  const text = [
    subject,
    intro,
    input.projectNames.map((name) => `- ${name}`).join('\n'),
    href ? `Open it: ${href}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return { subject, html, text }
}
