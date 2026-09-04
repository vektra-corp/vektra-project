import { Progress, cn } from '@pm/ui'
import Link from 'next/link'

export interface ProjectProgressRow {
  id: string
  name: string
  workspaceSlug: string
  done: number
  total: number
}

/**
 * Per-project completion.
 *
 * A meter rather than a chart: each row is one ratio, and the comparison people
 * actually make is row-to-row, which stacked bars of a shared width already
 * support. The percentage is direct-labelled so the value never has to be
 * estimated from the bar's length.
 */
export function ProjectProgressList({
  orgSlug,
  projects,
}: {
  orgSlug: string
  projects: ProjectProgressRow[]
}) {
  return (
    <ul className="divide-y divide-border-subtle">
      {projects.map((project) => {
        const percent = project.total === 0 ? 0 : Math.round((project.done / project.total) * 100)

        return (
          <li key={project.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Link
                href={`/${orgSlug}/${project.workspaceSlug}/projects/${project.id}/board`}
                className="min-w-0 truncate text-[13px] transition-colors hover:text-primary"
              >
                {project.name}
              </Link>
              <span
                className={cn(
                  'label-meta shrink-0 tabular-nums',
                  percent === 100 ? 'text-success' : 'text-faint',
                )}
              >
                {percent}%
              </span>
            </div>
            <div className="flex items-center gap-2.5 pt-2">
              <Progress
                value={project.done}
                max={project.total || 1}
                className="h-1.5"
                aria-label={`${project.name} progress`}
              />
              <span className="label-meta shrink-0 tabular-nums text-faint">
                {project.done}/{project.total}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
