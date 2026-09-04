'use server'

import {
  DASHBOARD_COLUMNS,
  WIDGET_SPECS,
  isDashboardWidget,
  type WidgetPlacement,
} from '@pm/shared/constants'
import type { ActionResult, Json } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Dashboard layout persistence (§19.10).
 *
 * The layout arrives from a drag in the browser, so every field is re-derived
 * or clamped here — a widget cannot be saved wider than the grid, shorter than
 * its minimum, or with a type the catalogue does not contain.
 */
function sanitizeLayout(raw: unknown): WidgetPlacement[] {
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()

  return raw.flatMap((entry): WidgetPlacement[] => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    if (!isDashboardWidget(item.type)) return []

    const id = typeof item.widget_id === 'string' ? item.widget_id : ''
    // Duplicate ids would make React keys collide and the grid lose track of
    // which widget moved.
    if (!id || seen.has(id)) return []
    seen.add(id)

    const spec = WIDGET_SPECS[item.type]
    const int = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback

    const w = Math.max(spec.minW, Math.min(DASHBOARD_COLUMNS, int(item.w, spec.w)))

    return [
      {
        widget_id: id.slice(0, 64),
        type: item.type,
        // Clamp x so the widget cannot be parked outside the grid.
        x: Math.max(0, Math.min(DASHBOARD_COLUMNS - w, int(item.x, 0))),
        y: Math.max(0, int(item.y, 0)),
        w,
        h: Math.max(spec.minH, int(item.h, spec.h)),
      },
    ]
  })
}

export async function saveDashboardLayout(
  orgSlug: string,
  layout: unknown,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  const clean = sanitizeLayout(layout)

  // A dashboard with 60 widgets is a mistake or an attack, not a preference.
  if (clean.length > 24) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Too many widgets on one dashboard.' }
  }

  const supabase = createClient()

  try {
    const { error } = await supabase.from('dashboard_configs').upsert(
      {
        organization_id: auth.orgId,
        user_id: auth.userId,
        name: 'My Dashboard',
        is_default: true,
        layout: clean as unknown as Json,
      },
      { onConflict: 'organization_id,user_id,name' },
    )

    if (error) throw error

    revalidatePath(`/${orgSlug}/dashboard`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function resetDashboardLayout(orgSlug: string): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  const supabase = createClient()

  try {
    // Deleting rather than rewriting: absence is what makes the page fall back
    // to DEFAULT_DASHBOARD, so there is one definition of "default", not two.
    const { error } = await supabase
      .from('dashboard_configs')
      .delete()
      .eq('organization_id', auth.orgId)
      .eq('user_id', auth.userId)

    if (error) throw error

    revalidatePath(`/${orgSlug}/dashboard`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
