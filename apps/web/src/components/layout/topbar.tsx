import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { AvatarStack, Skeleton, type StackedPerson } from '@pm/ui'
import Link from 'next/link'
import { Suspense, type ReactNode } from 'react'
import { InviteDialog } from '@/app/(dashboard)/[orgSlug]/members/invite-dialog'
import { TopbarPaletteTrigger } from '@/components/layout/palette-trigger'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export interface Crumb {
  label: string
  href?: string
}

/**
 * Section header: breadcrumb and context on the left, global actions on the right.
 *
 * Rendered by the innermost layout that knows its own breadcrumb rather than by
 * the org shell, because only that layout has the names — the org shell would
 * have to re-derive them from the URL.
 *
 * The header itself is now synchronous. It used to await the member list before
 * rendering anything, which put a query on the critical path of 18 pages —
 * and because the header is returned in the page's JSX, that query ran AFTER
 * the page's own awaits had resolved, adding a serial tail to every navigation.
 * The breadcrumb, which is the part that tells you where you are, was waiting on
 * a row of avatars. Now the members resolve inside their own Suspense boundary
 * and stream in; nothing else waits for them.
 */
export function Topbar({
  orgSlug,
  breadcrumb,
  meta,
}: {
  orgSlug: string
  breadcrumb: Crumb[]
  /** Context chip beside the breadcrumb, e.g. the sprint badge. */
  meta?: ReactNode
}) {
  return (
    <header className="border-border flex shrink-0 items-center gap-3 border-b px-5 py-[11px]">
      <div className="flex min-w-0 items-center gap-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-ui">
          {breadcrumb.map((crumb, index) => {
            const last = index === breadcrumb.length - 1
            return (
              <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
                {index > 0 ? (
                  <span className="text-subtle shrink-0" aria-hidden>
                    /
                  </span>
                ) : null}
                {crumb.href && !last ? (
                  <Link
                    href={crumb.href}
                    className="text-faint hover:text-foreground truncate transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={
                      last ? 'text-foreground truncate font-medium' : 'text-faint truncate'
                    }
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            )
          })}
        </nav>
        {meta}
      </div>

      <div className="ms-auto flex shrink-0 items-center gap-2.5">
        <TopbarPaletteTrigger />
        <Suspense fallback={<Skeleton className="h-7 w-[74px] rounded-md" />}>
          <TopbarInvite orgSlug={orgSlug} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-6 w-[41px] rounded-full" />}>
          <TopbarMembers orgSlug={orgSlug} />
        </Suspense>
      </div>
    </header>
  )
}

/**
 * The avatar stack, resolved off the critical path.
 *
 * The fallback is sized to the rendered stack (two 24px avatars overlapping) so
 * the header does not reflow when the real one arrives.
 */
async function TopbarMembers({ orgSlug }: { orgSlug: string }) {
  const auth = await requireAuthPage(orgSlug)
  const supabase = createClient()

  const { data: members } = await supabase
    .from('org_members')
    .select('user_id, profile:profiles!org_members_user_id_fkey(id, full_name, avatar_url)')
    .eq('organization_id', auth.orgId)
    .limit(12)

  const people: StackedPerson[] = (members ?? [])
    .map((row) => (Array.isArray(row.profile) ? row.profile[0] : row.profile))
    .filter((profile): profile is { id: string; full_name: string; avatar_url: string | null } =>
      Boolean(profile),
    )
    .map((profile) => ({ id: profile.id, name: profile.full_name, avatarUrl: profile.avatar_url }))

  if (people.length === 0) return null
  return <AvatarStack people={people} max={2} />
}

/**
 * Invite, from anywhere.
 *
 * Owners and admins add people constantly and were previously required to
 * navigate to Members first; the action belongs wherever they happen to be. It
 * resolves in its own Suspense boundary for the same reason the avatar stack
 * does — the breadcrumb must not wait on a workspace query to paint.
 *
 * Role is re-read here rather than passed down: every page renders this header,
 * and a prop would let one of them pass the wrong answer.
 */
async function TopbarInvite({ orgSlug }: { orgSlug: string }) {
  const auth = await requireAuthPage(orgSlug)
  if (!(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) return null

  const supabase = createClient()

  const [{ data: workspaces }, { data: projects }] = await Promise.all([
    supabase.from('workspaces').select('id, name').eq('organization_id', auth.orgId).order('name'),
    supabase
      .from('projects')
      .select('id, name, workspace_id')
      .eq('organization_id', auth.orgId)
      .neq('status', 'archived')
      .order('name'),
  ])

  return (
    <InviteDialog
      orgSlug={orgSlug}
      actorRole={auth.orgRole}
      workspaces={workspaces ?? []}
      projects={(projects ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        workspaceId: project.workspace_id,
      }))}
      trigger="compact"
    />
  )
}
