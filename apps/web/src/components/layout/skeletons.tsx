import { Skeleton } from '@pm/ui'
import { PageBody } from './page-body'

/**
 * Route-level loading placeholders (claude.md §23.2 rule 4: never a blank space).
 *
 * These exist because without a Suspense boundary the App Router leaves the
 * PREVIOUS page on screen, frozen, for the whole server render — a click looks
 * like it did nothing. A `loading.tsx` re-exporting one of these turns that dead
 * time into immediate feedback.
 *
 * Every skeleton reproduces the real shell's geometry rather than approximating
 * it: the header is the same h-[52px] with the same border as `Topbar`, and the
 * body goes through `PageBody` so the scroll container matches. A fallback whose
 * metrics differ from the content shifts the layout the moment data lands, which
 * reads as a second, worse flash.
 */

/** Header bar matching `Topbar`'s height, border and padding exactly. */
export function TopbarSkeleton() {
  return (
    <header className="border-border flex h-[52px] shrink-0 items-center justify-between gap-4 border-b px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Skeleton className="h-[26px] w-[104px] rounded-md" />
        <Skeleton className="h-6 w-6 rounded-full" />
      </div>
    </header>
  )
}

/** Title block matching `PageHeading`'s spacing. */
export function HeadingSkeleton({ withAction = true }: { withAction?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-4 pt-4">
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
      {withAction ? <Skeleton className="h-8 w-28 rounded-md" /> : null}
    </div>
  )
}

/**
 * Rows of a list or table.
 *
 * Widths are deliberately uneven and derived from the column index so the block
 * reads as text rather than as a grid of identical bars.
 */
export function TableSkeleton({ rows = 8, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="border-border bg-surface-hover/40 flex items-center gap-4 border-b px-4 py-2.5">
        {Array.from({ length: cols }).map((_, col) => (
          <Skeleton key={col} className={col === 0 ? 'h-3 flex-[3]' : 'h-3 flex-1'} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="border-border flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
        >
          {Array.from({ length: cols }).map((_, col) => (
            <Skeleton key={col} className={col === 0 ? 'h-3.5 flex-[3]' : 'h-3.5 flex-1'} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Kanban columns with a varying number of cards each. */
export function BoardSkeleton({ columns = 4 }: { columns?: number }) {
  // A fixed pattern, not Math.random(): the server and client must render the
  // same markup or React reports a hydration mismatch.
  const cardsPerColumn = [4, 3, 5, 2, 3, 4]

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 pt-4">
      {Array.from({ length: columns }).map((_, col) => (
        <div key={col} className="bg-surface-hover/30 w-[280px] shrink-0 rounded-lg p-2.5">
          <div className="flex items-center justify-between px-1 pb-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-5" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: cardsPerColumn[col % cardsPerColumn.length] ?? 3 }).map(
              (__, card) => (
                <div key={card} className="bg-background border-border space-y-2.5 rounded-md border p-3">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-2/3" />
                  <div className="flex items-center gap-2 pt-0.5">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="ms-auto h-3 w-10" />
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Card grid for project lists and dashboard widgets. */
export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: cards }).map((_, card) => (
        <div key={card} className="border-border space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <div className="flex items-center gap-2 pt-1">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="ms-auto h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Two-column detail view: main body plus a metadata rail. */
export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 pt-4 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-4">
        <Skeleton className="h-6 w-3/5" />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
        <div className="border-border space-y-3 rounded-lg border p-4">
          <Skeleton className="h-3 w-28" />
          {Array.from({ length: 3 }).map((_, row) => (
            <div key={row} className="flex items-start gap-2.5">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3.5 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="w-full shrink-0 space-y-3 lg:w-64">
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Horizontal bars on a date scale, for the Gantt view. */
export function TimelineSkeleton({ rows = 8 }: { rows?: number }) {
  // Fixed offsets and widths so server and client markup agree.
  const bars = [
    { start: 0, width: 40 },
    { start: 12, width: 30 },
    { start: 22, width: 45 },
    { start: 8, width: 25 },
    { start: 35, width: 35 },
    { start: 18, width: 50 },
    { start: 45, width: 28 },
    { start: 5, width: 38 },
  ]

  return (
    <div className="pt-4">
      <div className="border-border flex items-center gap-4 border-b pb-2.5">
        {Array.from({ length: 6 }).map((_, col) => (
          <Skeleton key={col} className="h-3 flex-1" />
        ))}
      </div>
      <div className="space-y-2.5 pt-3">
        {Array.from({ length: rows }).map((_, row) => {
          const bar = bars[row % bars.length]!
          return (
            <div key={row} className="flex items-center gap-4">
              <Skeleton className="h-3.5 w-40 shrink-0" />
              <div className="relative h-6 flex-1">
                <Skeleton
                  className="absolute h-6 rounded"
                  style={{ insetInlineStart: `${bar.start}%`, width: `${bar.width}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Default whole-page fallback: header, heading and a neutral body.
 *
 * `variant` picks the body shape. Anything without a closer match uses 'rows',
 * which is vague enough not to promise a layout the page will not deliver.
 */
export function PageSkeleton({
  variant = 'rows',
  withAction = true,
}: {
  variant?: 'rows' | 'table' | 'cards' | 'board' | 'detail' | 'timeline'
  withAction?: boolean
}) {
  return (
    <>
      <TopbarSkeleton />
      <PageBody>
        <HeadingSkeleton withAction={withAction} />
        {variant === 'table' ? <TableSkeleton /> : null}
        {variant === 'cards' ? <CardGridSkeleton /> : null}
        {variant === 'board' ? <BoardSkeleton /> : null}
        {variant === 'detail' ? <DetailSkeleton /> : null}
        {variant === 'timeline' ? <TimelineSkeleton /> : null}
        {variant === 'rows' ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, row) => (
              <div key={row} className="border-border space-y-2.5 rounded-lg border p-4">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        ) : null}
      </PageBody>
    </>
  )
}

/**
 * Body-only fallback for a section whose layout already renders its own Topbar.
 *
 * Using `PageSkeleton` there would draw a second header below the real one.
 */
export function SectionSkeleton({
  variant = 'rows',
}: {
  variant?: 'rows' | 'table' | 'cards' | 'board' | 'detail' | 'timeline'
}) {
  return (
    <PageBody>
      <HeadingSkeleton />
      {variant === 'table' ? <TableSkeleton /> : null}
      {variant === 'cards' ? <CardGridSkeleton /> : null}
      {variant === 'board' ? <BoardSkeleton /> : null}
      {variant === 'detail' ? <DetailSkeleton /> : null}
      {variant === 'timeline' ? <TimelineSkeleton /> : null}
      {variant === 'rows' ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, row) => (
            <div key={row} className="border-border space-y-2.5 rounded-lg border p-4">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : null}
    </PageBody>
  )
}
