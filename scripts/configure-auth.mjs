import './load-env.mjs'

/**
 * Apply this project's auth email configuration to a Supabase project.
 *
 * SMTP settings and email templates are per project and are NOT carried over by
 * a database migration — moving from the Sydney project to Mumbai silently left
 * both at their defaults, and signup mail stopped being delivered. Doing it by
 * hand in the dashboard is three screens of typing that nobody remembers a month
 * later, so it lives here instead.
 *
 * The templates must send `{{ .Token }}`. The app verifies a six-digit code
 * through `verifyOtp`; Supabase's stock template sends a magic link, which means
 * the email would contain nothing the sign-up screen can accept.
 *
 * Needs a personal access token (SUPABASE_ACCESS_TOKEN) from
 * https://supabase.com/dashboard/account/tokens — the anon and service-role keys
 * do not work here, this is the management API, not the database.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/configure-auth.mjs
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/configure-auth.mjs --dry-run
 */

const DRY_RUN = process.argv.includes('--dry-run')

const token = process.env.SUPABASE_ACCESS_TOKEN
const resendKey = process.env.RESEND_API_KEY
const from = process.env.RESEND_FROM_EMAIL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN.')
  console.error('Create one at https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}
if (!resendKey || !from || !supabaseUrl) {
  console.error('Missing RESEND_API_KEY, RESEND_FROM_EMAIL or NEXT_PUBLIC_SUPABASE_URL.')
  console.error('Expected them in apps/web/.env.local, which this script reads automatically.')
  process.exit(1)
}

/** `https://<ref>.supabase.co` — the ref is the only part the API wants. */
const ref = new URL(supabaseUrl).hostname.split('.')[0]

const CODE = 'font-size:28px;letter-spacing:6px;font-family:monospace'

/** Kept identical to docs/AUTH.md; that file explains the reasoning. */
const CONFIRMATION = `<h2>Confirm your email</h2>
<p>Enter this code to finish signing up:</p>
<p style="${CODE}">{{ .Token }}</p>
<p>The code expires in an hour. If you did not sign up, ignore this email.</p>`

const RECOVERY = `<h2>Reset your password</h2>
<p>Enter this code to choose a new password:</p>
<p style="${CODE}">{{ .Token }}</p>
<p>The code expires in an hour. If you did not ask for this, ignore this email.</p>`

const config = {
  // Resend over SMTP. Port 465 is implicit TLS, so the connection is encrypted
  // before the credentials are sent rather than after a STARTTLS upgrade.
  smtp_host: 'smtp.resend.com',
  smtp_port: '465',
  smtp_user: 'resend',
  smtp_pass: resendKey,
  smtp_admin_email: from,
  smtp_sender_name: 'Vektra Projects',

  mailer_subjects_confirmation: 'Your confirmation code',
  mailer_subjects_recovery: 'Your password reset code',
  mailer_templates_confirmation_content: CONFIRMATION,
  mailer_templates_recovery_content: RECOVERY,

  // Matches what both templates promise the reader.
  mailer_otp_exp: 3600,
}

const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

const mask = (value) =>
  typeof value === 'string' && value.length > 12 ? `${value.slice(0, 6)}…(${value.length})` : value

console.log(`Project ${ref}${DRY_RUN ? '  (dry run)' : ''}`)

const before = await fetch(api, { headers })
if (!before.ok) {
  console.error(`\nGET failed: ${before.status} ${before.statusText}`)
  console.error(before.status === 401 ? 'The access token was rejected.' : await before.text())
  process.exit(1)
}
const current = await before.json()

console.log('\nBefore')
console.log(`  smtp_host              ${current.smtp_host || '(built-in mailer)'}`)
console.log(`  smtp_admin_email       ${current.smtp_admin_email || '—'}`)
console.log(
  `  confirmation template  ${
    (current.mailer_templates_confirmation_content || '').includes('{{ .Token }}')
      ? 'sends a code'
      : 'DEFAULT — sends a magic link, which the app cannot accept'
  }`,
)

if (DRY_RUN) {
  console.log('\nWould set')
  for (const [key, value] of Object.entries(config)) {
    console.log(`  ${key.padEnd(38)} ${mask(String(value).split('\n')[0])}`)
  }
  process.exit(0)
}

const patch = await fetch(api, { method: 'PATCH', headers, body: JSON.stringify(config) })
if (!patch.ok) {
  console.error(`\nPATCH failed: ${patch.status} ${patch.statusText}`)
  console.error(await patch.text())
  process.exit(1)
}

// Read it back rather than trusting the 200 — a field the API silently ignores
// would otherwise look like a success.
const after = await (await fetch(api, { headers })).json()

const checks = [
  ['SMTP host', after.smtp_host === 'smtp.resend.com', after.smtp_host || '—'],
  ['SMTP port', String(after.smtp_port) === '465', after.smtp_port ?? '—'],
  ['SMTP user', after.smtp_user === 'resend', after.smtp_user || '—'],
  ['Sender', after.smtp_admin_email === from, after.smtp_admin_email || '—'],
  [
    'Confirmation sends a code',
    (after.mailer_templates_confirmation_content || '').includes('{{ .Token }}'),
    '',
  ],
  ['Recovery sends a code', (after.mailer_templates_recovery_content || '').includes('{{ .Token }}'), ''],
  [
    'No magic link left behind',
    !`${after.mailer_templates_confirmation_content} ${after.mailer_templates_recovery_content}`.includes(
      'ConfirmationURL',
    ),
    '',
  ],
]

console.log('\nAfter')
let failed = 0
for (const [label, ok, detail] of checks) {
  if (!ok) failed += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)} ${detail}`)
}

// The redirect allow-list is left alone — it differs per environment and
// overwriting it would break whatever is already deployed. Just say so.
const allowList = after.uri_allow_list || ''
console.log(`\n  Site URL          ${after.site_url || '—'}`)
console.log(`  Redirect allow-list  ${allowList || '(empty)'}`)
if (!allowList.includes('/auth/callback')) {
  console.log('  NOTE  no /auth/callback entry — OAuth and invite links will bounce.')
}

console.log(failed === 0 ? '\nAuth email configured.' : `\n${failed} setting(s) did not apply.`)
process.exit(failed === 0 ? 0 : 1)
