import { cn } from '../utils'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'

export interface StackedPerson {
  id: string
  name: string
  avatarUrl?: string | null
}

/**
 * Overlapping avatars with a "+N" remainder, as in the board header.
 *
 * The remainder is drawn as one more circle in the stack rather than as a
 * caption beside it, which is how the design draws it — the row reads as a
 * single object, and stays a fixed width whatever the member count.
 *
 * Each avatar carries a 1.5px ring in the page's own background so the circles
 * separate where they overlap without a gap opening between them.
 */
export function AvatarStack({
  people,
  max = 3,
  className,
  size = 'default',
}: {
  people: StackedPerson[]
  max?: number
  className?: string
  size?: 'sm' | 'default'
}) {
  const shown = people.slice(0, max)
  const overflow = people.length - shown.length
  const dim = size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[9.5px]'

  return (
    <div className={cn('flex items-center -space-x-[7px]', className)}>
      {shown.map((person) => (
        <Avatar
          key={person.id}
          className={cn(dim, 'ring-background shrink-0 ring-[1.5px]')}
          title={person.name}
        >
          {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
          <AvatarFallback className="bg-surface-hover text-muted-foreground font-semibold uppercase">
            {person.name.slice(0, 2)}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            dim,
            'ring-background bg-chip text-muted-foreground grid shrink-0 place-items-center rounded-full font-semibold tabular-nums ring-[1.5px]',
          )}
          title={`${overflow} more`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
