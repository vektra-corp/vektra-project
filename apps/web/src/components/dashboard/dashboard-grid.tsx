'use client'

import {
  DASHBOARD_COLUMNS,
  DASHBOARD_ROW_HEIGHT,
  WIDGET_SPECS,
  type DashboardWidgetType,
  type WidgetPlacement,
} from '@pm/shared/constants'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
  toast,
} from '@pm/ui'
import { Check, GripVertical, Plus, RotateCcw, Users, X } from 'lucide-react'
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

/**
 * Configurable dashboard (§19.10).
 *
 * Widgets are rendered on the server and passed in as a map, so editing the
 * layout never re-fetches their data — dragging a widget moves a box that is
 * already painted. Only the placement is client state.
 */
export function DashboardGrid({
  orgSlug,
  initialLayout,
  widgets,
  availableTypes,
  canPublishDefault = false,
}: {
  orgSlug: string
  initialLayout: WidgetPlacement[]
  /** Pre-rendered widget bodies, keyed by widget type. */
  widgets: Partial<Record<DashboardWidgetType, ReactNode>>
  availableTypes: DashboardWidgetType[]
  /** Admins can publish their arrangement as the org-wide starting point. */
  canPublishDefault?: boolean
}) {
  const [editing, setEditing] = useState(false)
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

  const used = new Set(placements.map((item) => item.type))
  const addable = availableTypes.filter((type) => !used.has(type))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="subtle" size="sm" disabled={addable.length === 0}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add widget
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Widgets</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {addable.map((type) => (
                  <DropdownMenuItem key={type} onSelect={() => addWidget(type)}>
                    <span className="min-w-0">
                      <span className="block text-base">{WIDGET_SPECS[type].label}</span>
                      <span className="block text-nav text-faint">
                        {WIDGET_SPECS[type].description}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
                {addable.length === 0 ? (
                  <p className="px-2 py-3 text-center text-nav text-faint">
                    Every widget is already placed.
                  </p>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Reset
            </Button>

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
                <Users className="h-3.5 w-3.5" aria-hidden />
                Set as org default
              </Button>
            ) : null}

            <span className="label-meta ms-auto hidden text-faint sm:block">
              Drag to move, corner to resize
            </span>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPlacements(initialLayout)
                setEditing(false)
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button size="sm" loading={pending} onClick={save}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Done
            </Button>
          </>
        ) : (
          <Button variant="subtle" size="sm" className="ms-auto" onClick={() => setEditing(true)}>
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
            Customize
          </Button>
        )}
      </div>

      {/* The library types its ref as RefObject<T | null> (React 19's shape);
          this app is on React 18 types, where RefObject<T>.current is
          non-nullable. Same object at runtime, so the cast is the narrow fix. */}
      <div ref={containerRef as React.RefObject<HTMLDivElement>} className="-mx-2">
        {/* The grid needs a measured width; rendering it at zero would place
            every widget at the origin for one frame. */}
        {mounted ? (
          <GridLayout
            width={width}
            className={cn(editing && 'rounded-lg bg-surface/40 ring-1 ring-border-subtle')}
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
                <div className="relative h-full min-w-0 overflow-hidden">
                  {editing ? (
                    <button
                      type="button"
                      data-no-drag
                      onClick={() => removeWidget(placement.widget_id)}
                      aria-label={`Remove ${WIDGET_SPECS[placement.type].label}`}
                      className="absolute end-2 top-2 z-10 rounded-md bg-surface-overlay p-1 text-faint shadow-card transition-colors hover:text-destructive"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}

                  <div className={cn('h-full', editing && 'pointer-events-none select-none')}>
                    {widgets[placement.type] ?? (
                      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-nav text-faint">
                        {WIDGET_SPECS[placement.type].label} is unavailable
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </GridLayout>
        ) : (
          <div className="h-96 animate-pulse rounded-lg bg-surface/40" />
        )}
      </div>
    </div>
  )
}
