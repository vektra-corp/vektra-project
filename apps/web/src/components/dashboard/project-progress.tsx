import { cn } from '@pm/ui'
import Link from 'next/link'

export interface ProjectProgressRow {
  /** Internal uuid — the React key and the stats lookup, never a URL. */
  id: string
  /** 16-digit public id, which is what the link is built from. */
  publicId: string
  name: string
  workspaceSlug: string
  done: number
  total: number
}

/**
 * Per-project completion.
 *
 * A meter rather than a chart: each row is one ratio, and the comparison people
 * actually make is row-to-row, which bars of a shared width already support.
 * The count is direct-labelled so the value never has to be estimated from the
 * bar's length. One row per project, as the design lays it out — name, bar,
 * figure — so several widgets built from bars share a rhythm.
 */
export function ProjectProgressList({
  orgSlug,
  projects,
}: {
  orgSlug: string
  projects: ProjectProgressRow[]
}) {
  return (
    <ul className="scrollbar-slim flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {projects.map((project) => {
        const percent = project.total === 0 ? 0 : Math.round((project.done / project.total) * 100)

        return (
          <li key={project.id}>
            <Link
              href={`/${orgSlug}/${project.workspaceSlug}/projects/${project.publicId}/board`}
              className="hover:text-primary flex items-center gap-2.5 transition-colors"
            >
              <span className="text-muted-foreground w-[82px] shrink-0 truncate text-nav">
                {project.name}
              </span>
              <span className="bg-chip block h-1.5 flex-1 overflow-hidden rounded">
                <span
                  className={cn(
                    'block h-full rounded',
                    percent === 100 ? 'bg-success' : 'bg-primary',
                  )}
                  style={{ width: `${percent}%` }}
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${project.name} progress`}
                />
              </span>
              <span
                className={cn(
                  'shrink-0 whitespace-nowrap font-mono text-col tabular-nums',
                  percent === 100 ? 'text-success' : 'text-faint',
                )}
              >
                {project.done}/{project.total}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
