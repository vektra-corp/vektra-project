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
 * The overflow count is a single element rather than more avatars, so the
 * component stays a fixed width whatever the member count.
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
  const dim = size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[10px]'

  return (
    <div className={cn('flex items-center', className)}>
      <div className="flex -space-x-1.5">
        {shown.map((person) => (
          <Avatar key={person.id} className={cn(dim, 'ring-background ring-2')} title={person.name}>
            {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
            <AvatarFallback className="bg-surface-hover text-muted-foreground font-medium uppercase">
              {person.name.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {overflow > 0 ? (
        <span className="text-faint ms-1.5 font-mono text-[10px] font-medium tabular-nums">
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
