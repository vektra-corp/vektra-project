import 'server-only'

import { publicIdToString } from '@pm/shared/utils'
import { notifyEach } from './deliver'

/**
 * Who hears about a task, and why (claude.md §19).
 *
 * Assignment lives in a database trigger (migration 00036), not here — see the
 * note in `notifyTaskChange`. This module covers the changes that trigger does
 * not: priority, due dates, and status moves reported back to the assigner.
 *
 * Two audiences, and they are not the same person:
 *
 *   the ASSIGNEE  hears when work lands on them — a new assignment, a due date
 *                 that moved, a priority that changed under them.
 *   the ASSIGNER  hears when work they handed out changes — that is the whole
 *                 point of recording `assigner_id`, and nothing read it before.
 *
 * The actor never notifies themselves. Being told about your own edit is the
 * fastest way to teach someone to ignore the inbox.
 */

interface TaskRow {
  id?: string
  public_id?: string | number | null
  title: string
  status?: string | null
  priority?: string | null
  due_date?: string | null
  assignee_id?: string | null
  assigner_id?: string | null
}

interface Context {
  orgId: string
  orgSlug: string
  workspaceSlug: string
  projectId: string
  actorId: string
}

/** The task's own page, so a notification lands on the thing it is about. */
function taskUrl(context: Context, task: TaskRow, projectPublicId?: string | null): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const taskPublicId = publicIdToString(task.public_id ?? null)
  if (!appUrl || !taskPublicId || !projectPublicId) return null
  return `${appUrl}/${context.orgSlug}/${context.workspaceSlug}/projects/${projectPublicId}/tasks/${taskPublicId}`
}

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

function priorityLabel(value: string | null | undefined): string {
  return PRIORITY_LABELS[value ?? ''] ?? (value ?? 'unset')
}

/**
 * A task changed.
 *
 * `before` is read inside the same action that writes, so this can describe the
 * transition instead of announcing that something unspecified happened.
 */
export async function notifyTaskChange(input: {
  orgId: string
  orgSlug: string
  workspaceSlug: string
  projectId: string
  actorId: string
  before: TaskRow | null
  after: TaskRow
  projectPublicId?: string | null
}): Promise<void> {
  const { before, after } = input
  if (!before) return

  const context: Context = input
  const url = taskUrl(context, after, input.projectPublicId)

  const reassigned = before.assignee_id !== after.assignee_id && Boolean(after.assignee_id)
  const priorityChanged = before.priority !== after.priority
  const dueChanged = before.due_date !== after.due_date
  const statusChanged = before.status !== after.status

  // Assignment itself is NOT handled here. `notify_task_assignment` (migration
  // 00036) already writes that notification from a database trigger, with the
  // ids needed to build a link, and it fires however the row was changed — the
  // board, the API, an import. Writing a second one from here produced two
  // "assigned to you" rows for one save. What the trigger does not cover is
  // everything below: priority, due dates, and telling the ASSIGNER that work
  // they handed out has moved.
  //
  // `reassigned` is still read, to suppress the follow-up messages below for
  // someone who is about to get the trigger's assignment notification anyway.

  // --- priority ------------------------------------------------------------
  //
  // Told to the assignee AND the assigner: one is being asked to change what
  // they work on next, the other needs to know their request was re-ranked.
  if (priorityChanged) {
    const title = `Priority ${priorityLabel(after.priority)}: ${after.title}`
    const body = `Changed from ${priorityLabel(before.priority)} to ${priorityLabel(after.priority)}.`

    await notifyEach(
      [after.assignee_id, after.assigner_id ?? before.assigner_id],
      (userId) => ({
        orgId: input.orgId,
        orgSlug: input.orgSlug,
        userId,
        type: 'task_priority_changed',
        title,
        body,
        url,
        projectId: input.projectId,
        data: { task_id: after.id },
      }),
      // A reassignment already sent this person a dedicated message a moment
      // ago; a second one about the same save would be noise.
      { exclude: [input.actorId, reassigned ? after.assignee_id : null] },
    )
  }

  // --- due date ------------------------------------------------------------
  if (dueChanged) {
    const title = after.due_date
      ? `Due ${after.due_date}: ${after.title}`
      : `Due date cleared: ${after.title}`
    const body = before.due_date
      ? after.due_date
        ? `Moved from ${before.due_date}.`
        : `Was ${before.due_date}.`
      : 'A due date was set.'

    await notifyEach(
      [after.assignee_id, after.assigner_id ?? before.assigner_id],
      (userId) => ({
        orgId: input.orgId,
        orgSlug: input.orgSlug,
        userId,
        type: 'task_due_changed',
        title,
        body,
        url,
        projectId: input.projectId,
        data: { task_id: after.id },
      }),
      { exclude: [input.actorId, reassigned ? after.assignee_id : null] },
    )
  }

  // --- status, to the assigner ---------------------------------------------
  //
  // "If a user updates a task it should notify the assigned by" — the person
  // who handed the work out is the one waiting on it, and a status move is the
  // update they are waiting for.
  if (statusChanged) {
    const assigner = after.assigner_id ?? before.assigner_id
    await notifyEach(
      [assigner],
      (userId) => ({
        orgId: input.orgId,
        orgSlug: input.orgSlug,
        userId,
        type: 'task_status_changed',
        title: `${after.title} → ${after.status}`,
        body: `Moved from ${before.status} to ${after.status}.`,
        url,
        projectId: input.projectId,
        data: { task_id: after.id },
      }),
      { exclude: [input.actorId] },
    )
  }
}
