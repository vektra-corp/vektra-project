import { initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Badge, Button } from '@pm/ui'
import { differenceInCalendarDays } from 'date-fns'
import { LogOut } from 'lucide-react'
import Link from 'next/link'
import { signOut } from '@/app/(auth)/actions'
import { NotificationBell } from '@/components/notifications/notification-bell'

interface Organization {
  id: string
  name: string
  slug: string
  status: string
  trial_ends_at: string | null
  plan: { name: string; display_name: string } | { name: string; display_name: string }[] | null
}

export async function Topbar({
  orgSlug,
  organization,
  profile,
}: {
  orgSlug: string
  organization: Organization
  profile: { id: string; full_name: string; avatar_url: string | null }
}) {
  // PostgREST returns an embedded to-one relation as an object, but the
  // generated types allow an array; normalise rather than casting blindly.
  const plan = Array.isArray(organization.plan) ? organization.plan[0] : organization.plan

  const trialDaysLeft =
    organization.status === 'trial' && organization.trial_ends_at
      ? differenceInCalendarDays(new Date(organization.trial_ends_at), new Date())
      : null

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-6">
      <div className="flex items-center gap-3">
        {plan ? <Badge variant="secondary">{plan.display_name}</Badge> : null}
        {trialDaysLeft !== null ? (
          <Link href={`/${orgSlug}/settings/billing`}>
            <Badge variant={trialDaysLeft <= 3 ? 'destructive' : 'outline'}>
              {trialDaysLeft > 0 ? `${trialDaysLeft} days left in trial` : 'Trial ended'}
            </Badge>
          </Link>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <NotificationBell orgSlug={orgSlug} />

        <Avatar>
          {profile.avatar_url ? (
            <AvatarImage src={profile.avatar_url} alt="" />
          ) : null}
          <AvatarFallback>{initials(profile.full_name || '?')}</AvatarFallback>
        </Avatar>

        <form action={signOut}>
          <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
            <LogOut className="h-4 w-4" aria-hidden />
          </Button>
        </form>
      </div>
    </header>
  )
}
