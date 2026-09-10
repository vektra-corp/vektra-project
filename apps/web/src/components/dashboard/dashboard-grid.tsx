'use client'

import {
  DASHBOARD_COLUMNS,
  DASHBOARD_ROW_HEIGHT,
  WIDGET_SPECS,
  type DashboardWidgetType,
  type WidgetPlacement,
} from '@pm/shared/constants'
import { Button, cn, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback, useMemo, useState, useTransition, type ReactNode } from 'react'
import GridLayout, { useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout'
// Placeholder, drag transitions and resize handles. Imported here rather than in
// globals.css because postcss-import resolves a bare specifier as a relative path.
import 'react-grid-layout/css/styles.css'
import {
  publishOrgDashboardDefault,
  resetDashboardLayout,
  saveDashboardLayout,
} from '@/app/(dashboard)/[orgSlug]/dashboard/actions'
import { WidgetCatalog } from './widget-catalog'

/**
 * Configurable dashboard (§19.10).
 *
 * Widgets are rendered on the server and passed in as a map, so editing the
 * layout never re-fetches their data — dragging a widget moves a box that is
 * already painted. Only the placement is client state.
 *
 * The chrome is the design's: a header naming the dashboard and counting its
 * widgets, a live-refresh marker, the catalogue as a right-hand panel rather
 * than a dropdown, and — in edit mode — a dashed hint strip over the grid.
 */
export function DashboardGrid({
  orgSlug,
  name,
  tag,
  initialLayout,
  widgets,
  availableTypes,
  canPublishDefault = false,
}: {
  orgSlug: string
  /** The dashboard's name, shown in the header chip. */
  name: string
  /** PERSONAL / SHARED / ORG DEFAULT — where this layout came from. */
  tag: 'PERSONAL' | 'SHARED' | 'ORG DEFAULT'
  initialLayout: WidgetPlacement[]
  /** Pre-rendered widget bodies, keyed by widget type. */
  widgets: Partial<Record<DashboardWidgetType, ReactNode>>
  availableTypes: DashboardWidgetType[]
  /** Admins can publish their arrangement as the org-wide starting point. */
  canPublishDefault?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [placements, setPlacements] = useState(initialLayout)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // v2 takes an explicit width rather than a WidthProvider HOC; the hook
  // measures the container and re-reports on resize.
  const { width, mounted, containerRef } = useContainerWidth()

  const layout: LayoutItem[] = useMemo(
    () =>
      placements.map((placement) => {
        const spec = WIDGET_SPECS[placement.type]
        return {
          i: placement.widget_id,
          x: placement.x,
          y: placement.y,
          w: placement.w,
          h: placement.h,
          minW: spec.minW,
          minH: spec.minH,
          static: !editing,
        }
      }),
    [placements, editing],
  )

  const onLayoutChange = useCallback(
    (next: Layout) => {
      if (!editing) return
      setPlacements((current) =>
        current.map((placement) => {
          const item = next.find((entry) => entry.i === placement.widget_id)
          return item
            ? { ...placement, x: item.x, y: item.y, w: item.w, h: item.h }
            : placement
        }),
      )
    },
    [editing],
  )

  function addWidget(type: DashboardWidgetType) {
    // One of each. None of these widgets takes per-instance configuration, so a
    // second copy renders exactly the same panel twice and only costs space.
    // (If widgets ever gain their own filters, this is the line to relax.)
    if (placements.some((item) => item.type === type)) {
      setEditing(true)
      return
    }

    const spec = WIDGET_SPECS[type]
    // Drop it below everything so it never lands on top of existing widgets.
    const bottom = placements.reduce((max, item) => Math.max(max, item.y + item.h), 0)
    setPlacements((current) => [
      ...current,
      {
        widget_id: `w-${type}-${Date.now().toString(36)}`,
        type,
        x: 0,
        y: bottom,
        w: spec.w,
        h: spec.h,
      },
    ])
    // Adding from the catalogue implies you are arranging the board.
    setEditing(true)
  }

  function removeWidget(widgetId: string) {
    setPlacements((current) => current.filter((item) => item.widget_id !== widgetId))
  }

  function save() {
    startTransition(async () => {
      const result = await saveDashboardLayout(orgSlug, placements)
      if (result.ok) {
        setEditing(false)
        toast({ title: 'Dashboard saved' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not save', description: result.message })
      }
    })
  }

  function reset() {
    startTransition(async () => {
      const result = await resetDashboardLayout(orgSlug)
      if (result.ok) {
        setEditing(false)
        toast({ title: 'Dashboard reset' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not reset', description: result.message })
      }
    })
  }

  const placed = new Set(placements.map((item) => item.type))
  const tagTone =
    tag === 'ORG DEFAULT' ? 'text-warning' : tag === 'SHARED' ? 'text-primary' : 'text-status-review'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-[11px]">
        <div className="border-input flex items-center gap-2 rounded-[7px] border px-2.5 py-1">
          <span className="text-[14px] font-semibold">{name}</span>
          <span className={cn('font-mono text-[8.5px] uppercase tracking-[0.06em]', tagTone)}>
            {tag}
          </span>
        </div>

        <span className="text-subtle font-mono text-id uppercase tabular-nums">
          {placements.length} widgets · {DASHBOARD_COLUMNS}-col grid
        </span>

        <div className="ms-auto flex items-center gap-[9px]">
          <span className="text-subtle flex items-center gap-1.5 font-mono text-id uppercase">
            <span aria-hidden className="bg-primary h-1.5 w-1.5 rounded-full" />
            Live
          </span>

          <button
            type="button"
            onClick={() => setCatalogOpen((value) => !value)}
            className={cn(
              'rounded-[7px] border px-2.5 py-[5px] text-ui transition-colors',
              catalogOpen
                ? 'border-primary text-primary'
                : 'border-input text-muted-foreground hover:text-foreground',
            )}
          >
            <span aria-hidden className="font-glyph">
              ＋
            </span>{' '}
            Add widget
          </button>

          {editing ? (
            <>
              {canPublishDefault ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await publishOrgDashboardDefault(orgSlug)
                      toast(
                        result.ok
                          ? {
                              title: 'Published',
                              description:
                                'New members start from this layout. Existing dashboards are untouched.',
                            }
                          : { title: result.message, variant: 'destructive' },
                      )
                    })
                  }
                >
                  Set as org default
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setPlacements(initialLayout)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
              <Button size="sm" loading={pending} onClick={save}>
                Done
              </Button>
            </>
          ) : (
            <Button variant="subtle" size="sm" onClick={() => setEditing(true)}>
              Edit layout
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="scrollbar-slim min-w-0 flex-1 overflow-y-auto px-5 pb-[26px] pt-4">
          {editing ? (
            <div className="border-input bg-surface-raised text-faint mb-3.5 flex items-center gap-2.5 rounded-[9px] border border-dashed px-3.5 py-2.5 text-nav">
              <span>
                Drag a widget onto another to reorder · pull the corner handle to resize across the{' '}
                {DASHBOARD_COLUMNS}-column grid
              </span>
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                className="text-primary ms-auto shrink-0 transition-colors hover:underline"
              >
                Reset layout
              </button>
            </div>
          ) : null}

          {/* The library types its ref as RefObject<T | null> (React 19's shape);
              this app is on React 18 types, where RefObject<T>.current is
              non-nullable. Same object at runtime, so the cast is the narrow fix. */}
          <div ref={containerRef as React.RefObject<HTMLDivElement>} className="-mx-2">
            {/* The grid needs a measured width; rendering it at zero would place
                every widget at the origin for one frame. */}
            {mounted ? (
              <GridLayout
                width={width}
                layout={layout}
                gridConfig={{
                  cols: DASHBOARD_COLUMNS,
                  rowHeight: DASHBOARD_ROW_HEIGHT,
                  margin: [12, 12],
                  containerPadding: [8, 8],
                }}
                dragConfig={{ enabled: editing, cancel: '[data-no-drag]' }}
                resizeConfig={{ enabled: editing }}
                onLayoutChange={onLayoutChange}
              >
                {placements.map((placement) => (
                  <div key={placement.widget_id} className="min-w-0">
                    <div className="relative h-full min-w-0">
                      {editing ? (
                        <button
                          type="button"
                          data-no-drag
                          onClick={() => removeWidget(placement.widget_id)}
                          aria-label={`Remove ${WIDGET_SPECS[placement.type].label}`}
                          className="bg-surface-overlay text-faint hover:text-destructive absolute end-2.5 top-3 z-10 rounded-md p-1 text-[11px] leading-none transition-colors"
                        >
                          <span aria-hidden>✕</span>
                        </button>
                      ) : null}

                      <div className={cn('h-full', editing && 'pointer-events-none select-none')}>
                        {widgets[placement.type] ?? (
                          <div className="border-border text-faint flex h-full items-center justify-center rounded-[11px] border border-dashed text-nav">
                            {WIDGET_SPECS[placement.type].label} is unavailable
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </GridLayout>
            ) : (
              <div className="bg-surface/40 h-96 animate-pulse rounded-[11px]" />
            )}
          </div>
        </div>

        {catalogOpen ? (
          <WidgetCatalog
            available={availableTypes}
            placed={placed}
            onAdd={addWidget}
            onClose={() => setCatalogOpen(false)}
          />
        ) : null}
      </div>
    </div>
  )
}
