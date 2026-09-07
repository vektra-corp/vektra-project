import { formatRelativeTime } from '@pm/shared/utils'
import { Alert, AlertDescription } from '@pm/ui'
import { ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { SettingsPanel } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { MfaPanel } from './mfa-panel'
import { SessionList, type SessionRow } from './session-list'

export const metadata: Metadata = { title: 'Security' }

/**
 * Personal security settings (§13.6).
 *
 * Sessions are per person, not per organisation — this page shows the viewer
 * their own devices. An admin force-revoking a member's session is a separate
 * capability the RLS policy already allows and no UI exposes yet.
 */
export default async function SecurityPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  const locale = await getLocale()
  const supabase = createClient()

  // Mark rows whose GoTrue session has gone as revoked before listing, so the
  // list does not offer to revoke a device that already signed itself out.
  await supabase.rpc('prune_stale_sessions')

  const [{ data: sessions }, { data: sessionData }, { data: factors }] = await Promise.all([
    supabase
      .from('user_sessions')
      .select('id, device, ip_address, last_active_at, created_at, session_id')
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .order('last_active_at', { ascending: false })
      .limit(50),
    supabase.auth.getSession(),
    supabase.auth.mfa.listFactors(),
  ])

  // Only a verified factor is enforced at sign-in, so only a verified one
  // counts as "on" here.
  const verifiedFactor = (factors?.all ?? []).find((factor) => factor.status === 'verified')

  // Which row is this browser. Read from the JWT rather than guessed from the
  // IP, which several devices behind one NAT would share.
  let currentSessionId: string | null = null
  if (sessionData.session) {
    try {
      const claims = JSON.parse(
        Buffer.from(sessionData.session.access_token.split('.')[1] ?? '', 'base64url').toString(),
      ) as { session_id?: string }
      currentSessionId = claims.session_id ?? null
    } catch {
      currentSessionId = null
    }
  }

  const rows: SessionRow[] = (sessions ?? []).map((session) => ({
    id: session.id,
    device: session.device,
    // `inet` comes back as unknown from the generated types; it is a string.
    ipAddress: typeof session.ip_address === 'string' ? session.ip_address : null,
    lastActive: session.last_active_at,
    createdAt: session.created_at,
    isCurrent: Boolean(session.session_id) && session.session_id === currentSessionId,
  }))

  const formatWhen = Object.fromEntries(
    rows.map((row) => [row.id, formatRelativeTime(row.lastActive, locale)]),
  )

  return (
    <SettingsPanel>
      <div className="space-y-5 pb-10">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Security</h1>
          <p className="pt-1 text-base text-muted-foreground">
            Your active sessions on this account.
          </p>
        </div>

        <MfaPanel
          orgSlug={params.orgSlug}
          isEnrolled={Boolean(verifiedFactor)}
          factorId={verifiedFactor?.id ?? null}
        />

        <SessionList orgSlug={params.orgSlug} sessions={rows} formatWhen={formatWhen} />

        <Alert>
          <ShieldCheck aria-hidden />
          <AlertDescription>
            Revoking deletes the device&apos;s refresh token, so it cannot renew its access
            — but an access token already issued stays valid until it expires, up to an
            hour. For a lost device, change your password as well: that ends every session
            at once.
            <br />
            Sessions are recorded from your next sign-in onward, so one that started before
            this page existed will not be listed until you sign in again.
          </AlertDescription>
        </Alert>
      </div>
    </SettingsPanel>
  )
}
