# Authentication

Supabase Auth issues the JWTs; **Resend delivers the emails**; verification uses
a **six-digit code**, never a magic link.

## Why codes rather than links

A link in an email is followed by spam scanners, link previewers and corporate
security gateways before the recipient ever sees it. Supabase's confirmation and
recovery tokens are single-use, so a scanner that fetches the URL consumes the
token and the person is told their link has expired. A code is only ever entered
by a person.

The app has no `emailRedirectTo` or `redirectTo` in any auth call. If you add
one, you reintroduce the link.

## Supabase dashboard configuration

Two things must be set in the dashboard; neither lives in this repo.

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

## The flows

```
Sign up      /signup  → /verify?email=…                 → verifyOtp('signup')   → /onboarding
Reset        /forgot-password → /verify?type=recovery&email=… → verifyOtp('recovery') → /reset-password
```

`verifyOtp` establishes a session, which is why `/reset-password` can simply
change the password of the current user — and why it redirects to
`/forgot-password` when there is no session.

## Rules the code follows

- **Responses never reveal whether an account exists.** A wrong password, an
  unknown address and an expired code all produce the same message, and the
  reset and resend flows always report success.
- **Rate limited by IP** at five attempts a minute (§13.7), on sign-in, sign-up,
  verify and resend.
- **Changing a password ends every other session** (§13.6).
- **Invites** (`inviteUserByEmail`, for org members and portal users) still send
  a link, because the recipient has no password yet and nothing to type a code
  against. Those go through the same Resend SMTP.

## What is NOT custom

The token contract is entirely Supabase's. `auth.uid()` in all 150 RLS policies
reads a claim from a JWT that PostgREST validated against the project's signing
key, and `custom_access_token_hook` injects `org_id` / `org_role`. None of that
changed — only how the verification email is delivered and what it contains.
