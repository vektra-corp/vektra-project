'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export interface ActiveFilter {
  /** Search param the chip clears, e.g. `assignee`. */
  param: string
  value: string
  label: string
}

/**
 * The strip of active filters under the board toolbar.
 *
 * The design shows it only when something is filtered, and each chip clears its
 * own value on click, with a running count of what is being hidden on the right.
 * Selections live in the URL (§10), so this is a pure read of the search params.
 */
export function BoardFilterBar({
  filters,
  hiddenCount,
}: {
  filters: ActiveFilter[]
  /** Cards the filters are keeping off the board right now. */
  hiddenCount: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  if (filters.length === 0) return null

  function clearOne(param: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    const remaining = params.getAll(param).filter((entry) => entry !== value)
    params.delete(param)
    for (const entry of remaining) params.append(param, entry)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    for (const filter of filters) params.delete(filter.param)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <div className="border-border bg-surface flex shrink-0 items-center gap-2 border-b px-5 py-2">
      <span className="label-meta-lg text-subtle shrink-0">Filters</span>

      <ul className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <li key={`${filter.param}:${filter.value}`}>
            <button
              type="button"
              onClick={() => clearOne(filter.param, filter.value)}
              className="border-input bg-chip hover:border-subtle flex items-center gap-1.5 rounded-[6px] border px-[9px] py-[3px] text-micro transition-colors"
            >
              {filter.label}
              <span aria-hidden className="text-subtle">
                ✕
              </span>
              <span className="sr-only">Remove filter</span>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={clearAll}
        className="text-faint hover:text-foreground ms-auto shrink-0 text-micro transition-colors"
      >
        Clear all · {hiddenCount} hidden
      </button>
    </div>
  )
}
