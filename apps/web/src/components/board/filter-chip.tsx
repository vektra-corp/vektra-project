'use client'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from '@pm/ui'
import { ChevronDown } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

export interface FilterOption {
  value: string
  label: string
  /** Swatch colour shown before the label, for labels and priorities. */
  color?: string
}

/**
 * A multi-select board filter.
 *
 * The URL is the source of truth (§10): selections are search params, so a
 * filtered board survives a refresh and can be shared as a link. Toggling
 * replaces the history entry rather than pushing, so Back leaves the board
 * instead of unwinding one checkbox at a time.
 */
export function FilterChip({
  param,
  label,
  options,
}: {
  param: string
  label: string
  options: FilterOption[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const selected = searchParams.getAll(param)

  const apply = useCallback(
    (next: string[]) => {
      const params = new URLSearchParams(searchParams.toString())
      params.delete(param)
      for (const value of next) params.append(param, value)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [param, pathname, router, searchParams],
  )

  const active = selected.length > 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-7 select-none items-center gap-1.5 rounded-md px-2.5 text-base font-medium transition-colors',
          'focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2',
          active
            ? 'bg-surface-hover text-foreground shadow-card'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {label}
        {active ? (
          <span className="text-faint font-mono text-[10px] tabular-nums">{selected.length}</span>
        ) : null}
        <ChevronDown className="text-faint h-3 w-3" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.length === 0 ? (
          <p className="text-faint px-2 py-3 text-center text-nav">Nothing to filter by</p>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              // Radix closes on select by default; a multi-select must not.
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                apply(
                  checked
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value),
                )
              }
            >
              {option.color ? (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: option.color }}
                  aria-hidden
                />
              ) : null}
              <span className="truncate">{option.label}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
        {active ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => apply([])}>Clear</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
