import type * as React from 'react'
import { cn } from '../utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

export interface DataTableColumn<T> {
  key: string
  header: React.ReactNode
  /** Cell renderer. Receives the whole row so a cell can combine fields. */
  cell: (row: T) => React.ReactNode
  className?: string
  headClassName?: string
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Shown in place of the body when there are no rows. */
  empty?: React.ReactNode
  onRowClick?: (row: T) => void
  className?: string
}

/**
 * Typed table for list and report views.
 *
 * Columns carry their own renderer, so adding a column to the task report is a
 * data change rather than a JSX change — which is what §19.7's configurable
 * column set needs.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'No results found',
  onRowClick,
  className,
}: DataTableProps<T>) {
  return (
    /*
     * Full-bleed rather than a card: the design runs its tables edge to edge
     * with hairlines between rows, so the section header, the column strip and
     * the rows all share one left margin. A boxed table would inset the rows
     * from the header above it and read as a second surface on the page.
     */
    <div className={cn('border-border border-b', className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead key={column.key} className={column.headClassName}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="text-muted-foreground py-10 text-center text-ui"
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer' : undefined}
              >
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
