'use client'

import {
  WIDGET_CATEGORIES,
  WIDGET_CATEGORY_LABELS,
  WIDGET_SPECS,
  type DashboardWidgetType,
  type WidgetCategory,
} from '@pm/shared/constants'
import { cn } from '@pm/ui'

const CATEGORY_TONE: Record<WidgetCategory, string> = {
  pm: 'text-primary',
  revenue: 'text-status-review',
  timesheet: 'text-status-done',
  hr: 'text-warning',
  workflow: 'text-muted-foreground',
}

/**
 * The widget catalogue, as the design draws it: a 286px panel down the right of
 * the dashboard, grouped by module, with each row saying whether that widget is
 * already on the board.
 *
 * A placed widget stays listed rather than disappearing — the catalogue is a map
 * of what the dashboard *can* show, and a list that silently shrinks as you use
 * it makes that harder to read, not easier.
 */
export function WidgetCatalog({
  available,
  placed,
  onAdd,
  onClose,
}: {
  available: DashboardWidgetType[]
  placed: Set<DashboardWidgetType>
  onAdd: (type: DashboardWidgetType) => void
  onClose: () => void
}) {
  const groups = WIDGET_CATEGORIES.map((category) => ({
    category,
    items: available.filter((type) => WIDGET_SPECS[type].category === category),
  })).filter((group) => group.items.length > 0)

  return (
    <aside
      aria-label="Widget catalog"
      className="border-border bg-surface scrollbar-slim flex w-[286px] shrink-0 flex-col gap-3.5 overflow-y-auto border-s p-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-task font-semibold">Widget catalog</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close widget catalog"
          className="text-subtle hover:text-foreground ms-auto text-nav transition-colors"
        >
          <span aria-hidden>✕</span>
        </button>
      </div>

      {groups.map((group) => (
        <div key={group.category} className="flex flex-col gap-1.5">
          <h3 className={cn('label-meta-lg', CATEGORY_TONE[group.category])}>
            {WIDGET_CATEGORY_LABELS[group.category]}
          </h3>
          {group.items.map((type) => {
            const isPlaced = placed.has(type)
            return (
              <button
                key={type}
                type="button"
                onClick={() => onAdd(type)}
                title={WIDGET_SPECS[type].description}
                className="border-border bg-card hover:border-input flex items-center gap-[9px] rounded-lg border px-[11px] py-2.5 text-start transition-colors"
              >
                <span className="min-w-0 flex-1 truncate text-ui">{WIDGET_SPECS[type].label}</span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-meta uppercase',
                    isPlaced ? 'text-primary' : 'text-subtle',
                  )}
                >
                  {isPlaced ? 'On board' : 'Add'}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </aside>
  )
}
