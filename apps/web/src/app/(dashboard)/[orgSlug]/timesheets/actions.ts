'use server'

import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import type { ActionResult } from '@pm/shared/types'
import {
  fieldErrors,
  manualEntrySchema,
  timeEntryUpdateSchema,
  timerStartSchema,
} from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Time tracking (§19.1).
 *
 * Only one timer may run per person — enforced by a partial unique index, so a
 * second "Start" from another tab is refused by the database rather than
 * depending on this code winning a race.
 */

function timesheetsPath(orgSlug: string) {
  return `/${orgSlug}/timesheets`
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export async function startTimer(
  orgSlug: string,
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(orgSlug)

  const parsed = timerStartSchema.safeParse({
    project_id: formData.get('project_id'),
    task_id: formData.get('task_id') || null,
    description: formData.get('description') || null,
    is_billable: formData.get('is_billable') !== 'off',
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const supabase = createClient()

  try {
    const { data, error } = await supabase
      .from('time_entries')
      .insert({
        ...parsed.data,
        organization_id: auth.orgId,
        user_id: auth.userId,
        start_time: new Date().toISOString(),
        is_running: true,
      })
      .select('id')
      .single()

    if (error) {
      // 23505 on idx_time_entries_one_running: a timer is already going.
      if (error.code === '23505') {
        return {
          ok: false,
          code: 'CONFLICT',
          message: 'You already have a timer running. Stop it first.',
        }
      }
      throw error
    }

    revalidatePath(timesheetsPath(orgSlug))
    return { ok: true, data: { id: data.id } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function stopTimer(orgSlug: string, entryId: string): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  const supabase = createClient()

  try {
    // The duration is computed by sync_time_entry_duration from the two
    // timestamps; setting end_time is the whole instruction.
    const { error } = await supabase
      .from('time_entries')
      .update({ end_time: new Date().toISOString() })
      .eq('id', entryId)
      .eq('user_id', auth.userId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(timesheetsPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function logManualEntry(
  orgSlug: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)

  const parsed = manualEntrySchema.safeParse({
    project_id: formData.get('project_id'),
    task_id: formData.get('task_id') || null,
    description: formData.get('description') || null,
    entry_date: formData.get('entry_date'),
    duration_minutes: numberOrNull(formData.get('duration_minutes')) ?? 0,
    is_billable: formData.get('is_billable') !== 'off',
    hourly_rate: numberOrNull(formData.get('hourly_rate')),
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const supabase = createClient()

  try {
    const { entry_date, ...entry } = parsed.data

    const { error } = await supabase.from('time_entries').insert({
      ...entry,
      organization_id: auth.orgId,
      user_id: auth.userId,
      // A manual entry has no clock, so start_time anchors it to the day it is
      // logged against and end_time stays null — which is what keeps the
      // duration trigger from overwriting the number that was typed in.
      start_time: `${entry_date}T09:00:00Z`,
      is_running: false,
    })

    if (error) throw error

    revalidatePath(timesheetsPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateTimeEntry(
  orgSlug: string,
  entryId: string,
  patch: { description?: string | null; duration_minutes?: number; is_billable?: boolean },
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)

  const parsed = timeEntryUpdateSchema.safeParse(patch)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message ?? 'Invalid entry.',
    }
  }

  const supabase = createClient()

  try {
    // Editing an entry inside an approved timesheet would change a number a
    // manager has already signed off.
    const { data: entry } = await supabase
      .from('time_entries')
      .select('start_time')
      .eq('id', entryId)
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'Entry not found.' }

    const day = entry.start_time.slice(0, 10)
    const { data: period } = await supabase
      .from('timesheet_periods')
      .select('status')
      .eq('user_id', auth.userId)
      .eq('organization_id', auth.orgId)
      .lte('period_start', day)
      .gte('period_end', day)
      .maybeSingle()

    if (period && ['submitted', 'approved'].includes(period.status)) {
      return {
        ok: false,
        code: 'INVALID_STATUS',
        message: `That week is ${period.status} and can no longer be edited.`,
      }
    }

    const { error } = await supabase
      .from('time_entries')
      .update(parsed.data)
      .eq('id', entryId)
      .eq('user_id', auth.userId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(timesheetsPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteTimeEntry(
  orgSlug: string,
  entryId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('time_entries')
      .delete()
      .eq('id', entryId)
      .eq('user_id', auth.userId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(timesheetsPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Submit a week for approval.
 *
 * The totals are recomputed here from the entries rather than trusted from the
 * form: a submitted timesheet is the number a manager approves and, later, the
 * number that gets invoiced.
 */
export async function submitTimesheet(
  orgSlug: string,
  periodStart: string,
  periodEnd: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  const supabase = createClient()

  try {
    const { data: entries } = await supabase
      .from('time_entries')
      .select('duration_minutes, is_billable')
      .eq('user_id', auth.userId)
      .eq('organization_id', auth.orgId)
      .gte('start_time', `${periodStart}T00:00:00Z`)
      .lte('start_time', `${periodEnd}T23:59:59Z`)
      .eq('is_running', false)

    if (!entries?.length) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'There is no time to submit.' }
    }

    const totalMinutes = entries.reduce((sum, entry) => sum + entry.duration_minutes, 0)
    const billableMinutes = entries
      .filter((entry) => entry.is_billable)
      .reduce((sum, entry) => sum + entry.duration_minutes, 0)

    const { error } = await supabase.from('timesheet_periods').upsert(
      {
        organization_id: auth.orgId,
        user_id: auth.userId,
        period_start: periodStart,
        period_end: periodEnd,
        total_hours: Math.round((totalMinutes / 60) * 100) / 100,
        billable_hours: Math.round((billableMinutes / 60) * 100) / 100,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        rejection_note: null,
      },
      { onConflict: 'organization_id,user_id,period_start' },
    )

    if (error) throw error

    revalidatePath(timesheetsPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function decideTimesheet(
  orgSlug: string,
  periodId: string,
  status: 'approved' | 'rejected',
  note?: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only managers can decide timesheets.' }
  }

  const supabase = createClient()

  try {
    const { data: period } = await supabase
      .from('timesheet_periods')
      .select('user_id, status')
      .eq('id', periodId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!period) return { ok: false, code: 'NOT_FOUND', message: 'Timesheet not found.' }

    // Approving your own hours is the conflict of interest managers exist to
    // prevent. RLS cannot express "not yourself", so it is checked here.
    if (period.user_id === auth.userId && auth.orgRole !== 'owner') {
      return { ok: false, code: 'FORBIDDEN', message: 'You cannot decide your own timesheet.' }
    }

    if (period.status !== 'submitted') {
      return { ok: false, code: 'INVALID_STATUS', message: 'That timesheet is not awaiting a decision.' }
    }

    const { error } = await supabase
      .from('timesheet_periods')
      .update({
        status,
        approved_by: auth.userId,
        approved_at: new Date().toISOString(),
        rejection_note: status === 'rejected' ? (note ?? null) : null,
      })
      .eq('id', periodId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(timesheetsPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
