# Authentication

Supabase Auth issues the JWTs; **Resend delivers the emails**; verification uses
a **six-digit code**, never a magic link.

Six is set in two places that nothing links: `mailer_otp_length` on the Supabase
project, and the `\d{6}` check in `packages/shared/src/validators/auth.ts`. They
have already drifted once — the project issued 8-digit codes while the form
accepted 6, which looks to the user like the code is simply wrong. `pnpm
auth:configure` now refuses to run when the two disagree, so change them
together.

## Why codes rather than links

A link in an email is followed by spam scanners, link previewers and corporate
security gateways before the recipient ever sees it. Supabase's confirmation and
recovery tokens are single-use, so a scanner that fetches the URL consumes the
token and the person is told their link has expired. A code is only ever entered
by a person.

No **email** auth call carries an `emailRedirectTo` or a `redirectTo`. If you add
one, you reintroduce the link.

The one `redirectTo` in the codebase is on `signInWithOAuth`, where it is not a
link in an email but the address the browser is sent back to after Google — a
different mechanism with none of the scanner problem.

## Supabase project configuration

SMTP settings and email templates are stored **per Supabase project** and are not
carried across by a database migration. Moving from the Sydney project to Mumbai
left both at their defaults and signup mail stopped arriving, with no error
anywhere — the user row is created, the email simply never goes out.

Apply them with:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... pnpm auth:configure     # --dry-run to preview
```

The token is a personal access token from
<https://supabase.com/dashboard/account/tokens>; the anon and service-role keys
do not work, this is the management API rather than the database. The script
reads the settings back after writing them, so a field the API quietly ignores
shows up as a FAIL instead of passing for a 200.

The rest of this section is what that script sets, for doing it by hand.

### 1. SMTP — Authentication → Emails → SMTP Settings

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key (the same one in `RESEND_API_KEY`) |
| Sender email | must be on a domain verified in Resend |
| Sender name | your product name |

Supabase's built-in SMTP is rate limited to a handful of messages an hour and is
not for production. Until this is set, signup emails will silently not arrive at
any volume.

### 2. Email templates — Authentication → Emails → Templates

Both templates must send the **token**, not a URL. Replace the body of:

**Confirm signup**

```html
<h2>Confirm your email</h2>
<p>Enter this code to finish signing up:</p>
<p style="font-size:28px;letter-spacing:6px;font-family:monospace">{{ .Token }}</p>
<p>The code expires in an hour. If you did not sign up, ignore this email.</p>
```

**Reset password**

```html
<h2>Reset your password</h2>
<p>Enter this code to choose a new password:</p>
<p style="font-size:28px;letter-spacing:6px;font-family:monospace">{{ .Token }}</p>
<p>The code expires in an hour. If you did not ask for this, ignore this email.</p>
```

`{{ .ConfirmationURL }}` must not appear in either. Leaving it in means both a
link and a code are sent, and the scanner problem comes back.

### 3. Google — Authentication → Providers → Google

Sign-in with Google is offered on `/login` and `/signup`. It needs credentials
from a Google Cloud project and two redirect settings that are easy to get
subtly wrong:

1. **Google Cloud Console** → APIs & Services → Credentials → OAuth client ID
   (type: Web application). Under *Authorized redirect URIs* add **Supabase's**
   callback, not this app's:

   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

   Google returns to Supabase, and Supabase then returns to us. Putting the app
   URL here instead produces `redirect_uri_mismatch` at the consent screen.

2. **Supabase dashboard** → Authentication → Providers → Google: enable it and
   paste the client ID and client secret.

3. **Supabase dashboard** → Authentication → URL Configuration → *Redirect URLs*:
   add `https://<your-domain>/auth/callback`. This is the list our own
   `redirectTo` is checked against — an address that is not on it is silently
   replaced with the site URL, which looks like the `next` parameter being
   ignored. For Vercel previews add the wildcard
   `https://<project>-*.vercel.app/auth/callback`.

No environment variable is involved: the client secret lives in Supabase, never
in this repo.

## The flows

```
Sign up      /signup  → /verify?email=…                 → verifyOtp('signup')   → /onboarding
Reset        /forgot-password → /verify?type=recovery&email=… → verifyOtp('recovery') → /reset-password
Google       /login or /signup → Google consent → /auth/callback → exchangeCodeForSession → next
```

Google has no notion of signing up versus signing in, so both buttons run the
same action. Where someone lands afterwards is decided by `/` as it is for any
other session: an existing membership goes to that org's dashboard, a brand new
account falls through to `/onboarding`. A first sign-in has no
`pending_organization_name`, so the org name field there starts empty rather
than pre-filled.

Failures on that round trip come back as `/login?error=…` — `oauth_cancelled`
when the consent screen is dismissed, `oauth_failed` for everything else. The
provider's own `error_description` is never rendered; it is attacker-influencable
text.

`verifyOtp` establishes a session, which is why `/reset-password` can simply
change the password of the current user — and why it redirects to
`/forgot-password` when there is no session.

## Rules the code follows

- **Responses never reveal whether an account exists.** A wrong password, an
  unknown address and an expired code all produce the same message, and the
  reset and resend flows always report success.
- **Rate limited by IP** at five attempts a minute (§13.7), on sign-in, sign-up,
  verify, resend and the Google redirect.
- **Changing a password ends every other session** (§13.6).
- **Invites** (`inviteUserByEmail`, for org members and portal users) still send
  a link, because the recipient has no password yet and nothing to type a code
  against. Those go through the same Resend SMTP.

## What is NOT custom

The token contract is entirely Supabase's. `auth.uid()` in all 150 RLS policies
reads a claim from a JWT that PostgREST validated against the project's signing
key, and `custom_access_token_hook` injects `org_id` / `org_role`. None of that
changed — only how the verification email is delivered and what it contains.
