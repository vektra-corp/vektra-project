'use server'

import { assertCan } from '@pm/auth/rbac'
import {
  DEFAULT_CARD_FIELDS,
  KANBAN_CARD_FIELDS,
  KANBAN_COLOR_BY,
  KANBAN_GROUP_BY,
  KANBAN_SORT_BY,
  type KanbanCardField,
} from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Saved Kanban views (§19.8).
 *
 * A view is presentation, not data: it never changes a task, so these actions
 * are gated on `tasks.read` rather than on write access. Sharing a view is the
 * one exception — it makes a config visible to every project member — and is
 * limited to roles that can already shape the project.
 */

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

function projectPath(scope: Scope) {
  return `/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}`
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return (allowed as readonly string[]).includes(String(value)) ? (value as T) : fallback
}

export async function saveKanbanView(
  scope: Scope,
  boardId: string,
  viewId: string | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'read')

  const name = String(formData.get('name') ?? '').trim() || 'My view'
  const isShared = formData.get('is_shared') === 'on'

  if (isShared && !['owner', 'admin', 'manager'].includes(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only managers can share a view.' }
  }

  // Unknown values fall back to the default rather than reaching a CHECK
  // constraint as a 500 — the form is the only caller, but it is client input.
  const selected = formData.getAll('card_fields').map(String)
  const cardFields = KANBAN_CARD_FIELDS.filter((field) =>
    selected.includes(field),
  ) as KanbanCardField[]

  const patch = {
    name: name.slice(0, 100),
    is_shared: isShared,
    group_by: oneOf(KANBAN_GROUP_BY, formData.get('group_by'), 'status'),
    card_fields: (cardFields.length > 0 ? cardFields : DEFAULT_CARD_FIELDS) as never,
    card_color_by: oneOf(KANBAN_COLOR_BY, formData.get('card_color_by'), 'priority'),
    sort_by: oneOf(KANBAN_SORT_BY, formData.get('sort_by'), 'position'),
    sort_order: formData.get('sort_order') === 'desc' ? 'desc' : 'asc',
    show_empty_columns: formData.get('show_empty_columns') === 'on',
    compact_mode: formData.get('compact_mode') === 'on',
  }

  const supabase = createClient()

  try {
    if (viewId && viewId !== 'default') {
      const { data, error } = await supabase
        .from('kanban_view_configs')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', viewId)
        .eq('organization_id', auth.orgId)
        .select('id')
        .single()

      if (error) throw error
      revalidatePath(projectPath(scope))
      return { ok: true, data: { id: data.id } }
    }

    const { data, error } = await supabase
      .from('kanban_view_configs')
      .insert({
        ...patch,
        board_id: boardId,
        organization_id: auth.orgId,
        created_by: auth.userId,
        // The first view someone saves becomes what they land on next time.
        is_default: true,
      })
      .select('id')
      .single()

    if (error) throw error

    revalidatePath(projectPath(scope))
    return { ok: true, data: { id: data.id } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteKanbanView(
  scope: Scope,
  viewId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  const supabase = createClient()

  try {
    // RLS already limits deletion to the view's creator; scoping by org here is
    // the explicit second layer, not a substitute for it.
    const { error } = await supabase
      .from('kanban_view_configs')
      .delete()
      .eq('id', viewId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(projectPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Apply a drop under a non-status grouping.
 *
 * Under status grouping the board moves the card through `moveTask`, which owns
 * the WIP check and the column/status pairing. Grouping by assignee or priority
 * instead means the drop edits that attribute, so it routes here.
 */
export async function applyViewDrop(
  scope: Scope,
  taskId: string,
  patch: Record<string, string | null>,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  // Only the two attributes a derived column can represent are writable here;
  // anything else would let a crafted drop patch arbitrary columns. Building the
  // update as a typed literal rather than a loop keeps that guarantee visible to
  // the compiler instead of resting on a cast.
  const safe: { assignee_id?: string | null; priority?: string } = {}
  if ('assignee_id' in patch) safe.assignee_id = patch.assignee_id ?? null
  if ('priority' in patch && patch.priority) safe.priority = patch.priority

  if (Object.keys(safe).length === 0) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'That drop changes nothing.' }
  }

  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('tasks')
      .update(safe)
      .eq('id', taskId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(projectPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
