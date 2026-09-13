import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Account unavailable' }

/**
 * The screen a suspended or banned tenant's users land on.
 *
 * Top-level, outside `(dashboard)`, so it renders without the org sidebar — the
 * product chrome around a lockout notice would be both confusing and wasteful,
 * since building it means loading the workspaces of a tenant who cannot use
 * them.
 *
 * The reason is the operator's own words (`organizations.status_reason`, set
 * through the console, which requires one before it will block anybody). It is
 * shown verbatim because the alternative — a generic "contact support" — sends
 * a person to ask a question the screen could have answered.
 *
 * A ban and a suspension read differently on purpose: one is reversible and
 * usually billing, the other is a decision. Telling someone their account is
 * "temporarily unavailable" when it has been banned only delays the real
 * conversation.
 */
export default async function BlockedPage({
  searchParams,
}: {
  searchParams: { org?: string }
}) {
  const slug = searchParams.org
  if (!slug) redirect('/')

  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS scopes this to organizations the viewer belongs to, so this page cannot
  // be used to probe the status of a tenant the visitor is not a member of.
  const { data: organization } = await supabase
    .from('organizations')
    .select('name, slug, status, status_reason')
    .eq('slug', slug)
    .maybeSingle()

  // Not a member, or the block has been lifted — either way there is nothing to
  // show here, and leaving them on this screen would strand them.
  if (!organization) redirect('/')
  if (organization.status !== 'suspended' && organization.status !== 'banned') {
    redirect(`/${organization.slug}`)
  }

  const banned = organization.status === 'banned'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">
            {banned ? `${organization.name} has been closed` : `${organization.name} is suspended`}
          </CardTitle>
          <CardDescription>
            {banned
              ? 'This organization no longer has access to Vektra Projects.'
              : 'Access is paused for everyone in this organization until this is resolved.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {organization.status_reason ? (
            <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
              <p className="label-meta text-faint">Reason</p>
              <p className="pt-1.5 text-[13px] leading-relaxed">{organization.status_reason}</p>
            </div>
          ) : null}

          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Your work is safe and nothing has been deleted.{' '}
            {banned
              ? 'If you believe this is a mistake, contact support@vektracorp.in.'
              : 'An organization owner can resolve this from billing, or contact support@vektracorp.in.'}
          </p>

          <a
            href="/select-org"
            className="text-[13px] text-primary transition-colors hover:underline"
          >
            Switch to another organization
          </a>
        </CardContent>
      </Card>
    </div>
  )
}
