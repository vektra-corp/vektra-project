import { cn } from '@pm/ui'
import Link from 'next/link'

export interface DependencyRow {
  id: string
  /** BLOCKS / BLOCKED BY / AFTER — the design's three relations. */
  kind: 'BLOCKS' | 'BLOCKED BY' | 'AFTER'
  /** `ATL-229` — the reference a person actually reads. */
  ref: string
  title: string
  href: string
  /** True when the other task is still open, which is what makes a block real. */
  isOpen: boolean
}

/**
 * A task's dependencies (§6.2 `task_dependencies`).
 *
 * The design lists them as a relation tag beside the task, so the direction is
 * legible at a glance: this task BLOCKS that one, is BLOCKED BY another, comes
 * AFTER a third.
 *
 * A blocker that is already closed is drawn in the neutral ink rather than red.
 * The row still matters — it records why the order was what it was — but it is
 * no longer something to act on, and colouring it as though it were makes the
 * live blockers harder to find.
 */
export function TaskDependencies({ dependencies }: { dependencies: DependencyRow[] }) {
  if (dependencies.length === 0) return null

  const tone = (row: DependencyRow) => {
    if (!row.isOpen) return 'text-subtle'
    return row.kind === 'BLOCKED BY' ? 'text-destructive' : 'text-warning'
  }

  return (
    <div className="border-border flex flex-col gap-[9px] border-t pt-2">
      <h3 className="label-meta-lg text-subtle">Dependencies</h3>
      <ul className="flex flex-col gap-2">
        {dependencies.map((row) => (
          <li key={row.id}>
            <Link href={row.href} className="group flex items-center gap-[9px]">
              <span
                className={cn('shrink-0 font-mono text-col uppercase', tone(row))}
                title={row.isOpen ? undefined : 'This task is already closed'}
              >
                {row.kind}
              </span>
              <span className="group-hover:text-primary min-w-0 truncate text-ui transition-colors">
                <span className="text-faint pe-1.5 font-mono text-id">{row.ref}</span>
                {row.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
