'use client'

import {
  TASK_REPORT_COLUMNS,
  TASK_REPORT_COLUMN_KEYS,
  type TaskReportColumn,
} from '@pm/shared/constants'
import { humanize } from '@pm/shared/utils'
import { Button, cn } from '@pm/ui'
import { X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

interface Member {
  id: string
  full_name: string
}

/**
 * Report filters and column picker.
 *
 * All state lives in the URL (§10): the view survives a refresh and can be
 * shared with a colleague as a link.
 */
export function ReportFilters({
  statuses,
  priorities,
  members,
  selectedColumns,
}: {
  statuses: readonly string[]
  priorities: readonly string[]
  members: Member[]
  selectedColumns: TaskReportColumn[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const current = useCallback(
    (key: string) => {
      const raw = searchParams.get(key)
      return raw ? raw.split(',').filter(Boolean) : []
    },
    [searchParams],
  )

  const setParam = useCallback(
    (key: string, values: string[]) => {
      const next = new URLSearchParams(searchParams.toString())
      if (values.length === 0) next.delete(key)
      else next.set(key, values.join(','))
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const toggle = (key: string, value: string) => {
    const values = current(key)
    setParam(key, values.includes(value) ? values.filter((v) => v !== value) : [...values, value])
  }

  const hasFilters =
    current('status').length > 0 || current('priority').length > 0 || current('assignee').length > 0

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <FilterRow label="Status">
        {statuses.map((status) => (
          <Chip
            key={status}
            active={current('status').includes(status)}
            onClick={() => toggle('status', status)}
          >
            {humanize(status)}
          </Chip>
        ))}
      </FilterRow>

      <FilterRow label="Priority">
        {priorities.map((priority) => (
          <Chip
            key={priority}
            active={current('priority').includes(priority)}
            onClick={() => toggle('priority', priority)}
          >
            {humanize(priority)}
          </Chip>
        ))}
      </FilterRow>

      {members.length > 0 ? (
        <FilterRow label="Assignee">
          {members.slice(0, 12).map((member) => (
            <Chip
              key={member.id}
              active={current('assignee').includes(member.id)}
              onClick={() => toggle('assignee', member.id)}
            >
              {member.full_name}
            </Chip>
          ))}
        </FilterRow>
      ) : null}

      <FilterRow label="Columns">
        {TASK_REPORT_COLUMN_KEYS.map((column) => {
          const def = TASK_REPORT_COLUMNS[column]
          const active = selectedColumns.includes(column)
          return (
            <Chip
              key={column}
              active={active}
              // A required column cannot be switched off (§19.7).
              disabled={def.required}
              onClick={() =>
                setParam(
                  'columns',
                  active
                    ? selectedColumns.filter((c) => c !== column)
                    : [...selectedColumns, column],
                )
              }
            >
              {def.label}
            </Chip>
          )
        })}
      </FilterRow>

      {hasFilters ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.replace(pathname, { scroll: false })}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {children}
    </button>
  )
}
