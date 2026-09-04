'use server'

import { ORG_ADMIN_ROLES, ORG_MANAGER_ROLES } from '@pm/auth/constants'
import type { ActionResult } from '@pm/shared/types'
import {
  employeeCreateSchema,
  employeeUpdateSchema,
  fieldErrors,
  leaveDecisionSchema,
  leaveRequestSchema,
  leaveTypeSchema,
} from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Employee records and leave (§19.5).
 *
 * Leave balances are never written here. The `sync_leave_balance` trigger moves
 * days between pending, used and released as a request changes state, so a
 * balance cannot drift from the requests that produced it — whatever path the
 * update took.
 */

function teamPath(orgSlug: string) {
  return `/${orgSlug}/team`
}

function isAdmin(role: string) {
  return (ORG_ADMIN_ROLES as readonly string[]).includes(role)
}

function isManager(role: string) {
  return (ORG_MANAGER_ROLES as readonly string[]).includes(role)
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

// --- Employees ----------------------------------------------------------------

export async function saveEmployee(
  orgSlug: string,
  employeeId: string | null,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  if (!isAdmin(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only admins can manage employee records.' }
  }

  const shared = {
    employee_code: formData.get('employee_code') || null,
    department: formData.get('department') || null,
    designation: formData.get('designation') || null,
    employment_type: formData.get('employment_type') || 'full_time',
    date_of_joining: formData.get('date_of_joining'),
    date_of_exit: formData.get('date_of_exit') || null,
    manager_id: formData.get('manager_id') || null,
    default_hourly_rate: numberOrNull(formData.get('default_hourly_rate')),
    skills: String(formData.get('skills') ?? '')
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean),
    status: formData.get('status') || 'active',
  }

  const supabase = createClient()

  // Parsed inside each branch rather than once: create and update have
  // different shapes, and a union of the two cannot be spread into a query.
  try {
    let error: { code?: string; message: string } | null

    if (employeeId) {
      const parsed = employeeUpdateSchema.safeParse(shared)
      if (!parsed.success) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'VALIDATION_ERROR',
          fieldErrors: fieldErrors(parsed.error),
        }
      }
      ;({ error } = await supabase
        .from('employees')
        .update(parsed.data)
        .eq('id', employeeId)
        .eq('organization_id', auth.orgId))
    } else {
      const parsed = employeeCreateSchema.safeParse({
        ...shared,
        user_id: formData.get('user_id'),
      })
      if (!parsed.success) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'VALIDATION_ERROR',
          fieldErrors: fieldErrors(parsed.error),
        }
      }
      ;({ error } = await supabase
        .from('employees')
        .insert({ ...parsed.data, organization_id: auth.orgId }))
    }

    if (error) {
      // (organization_id, user_id) is unique — one employee record per person.
      if (error.code === '23505') {
        return {
          ok: false,
          code: 'ALREADY_EXISTS',
          message: 'That person already has an employee record.',
        }
      }
      // The manager trigger raises a plain exception; surface its message,
      // which is already written for a person to read.
      if (error.code === 'P0001') {
        return { ok: false, code: 'CONFLICT', message: error.message }
      }
      throw error
    }

    revalidatePath(teamPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

// --- Leave types --------------------------------------------------------------

export async function saveLeaveType(
  orgSlug: string,
  leaveTypeId: string | null,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  if (!isAdmin(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only admins can manage leave types.' }
  }

  const parsed = leaveTypeSchema.safeParse({
    name: formData.get('name'),
    color: formData.get('color') || null,
    default_days: numberOrNull(formData.get('default_days')) ?? 0,
    is_paid: formData.get('is_paid') === 'on',
    requires_approval: formData.get('requires_approval') === 'on',
    is_active: formData.get('is_active') !== 'off',
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
    const { error } = leaveTypeId
      ? await supabase
          .from('leave_types')
          .update(parsed.data)
          .eq('id', leaveTypeId)
          .eq('organization_id', auth.orgId)
      : await supabase.from('leave_types').insert({ ...parsed.data, organization_id: auth.orgId })

    if (error) {
      if (error.code === '23505') {
        return { ok: false, code: 'ALREADY_EXISTS', message: 'That leave type already exists.' }
      }
      throw error
    }

    revalidatePath(`${teamPath(orgSlug)}/leave`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

// --- Leave requests -----------------------------------------------------------

export async function requestLeave(
  orgSlug: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  const supabase = createClient()

  const parsed = leaveRequestSchema.safeParse({
    leave_type_id: formData.get('leave_type_id'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date'),
    duration_days: numberOrNull(formData.get('duration_days')) ?? 0,
    reason: formData.get('reason') || null,
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  try {
    // You file leave as yourself. The employee id comes from the session, never
    // from the form — RLS enforces the same rule underneath.
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('organization_id', auth.orgId)
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (!employee) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'You do not have an employee record yet. Ask an admin to create one.',
      }
    }

    const { error } = await supabase.from('leave_requests').insert({
      ...parsed.data,
      employee_id: employee.id,
      organization_id: auth.orgId,
    })

    if (error) {
      // 23P01 is the exclusion constraint: overlapping pending/approved leave.
      if (error.code === '23P01') {
        return {
          ok: false,
          code: 'CONFLICT',
          message: 'You already have leave booked over those dates.',
        }
      }
      throw error
    }

    revalidatePath(`${teamPath(orgSlug)}/leave`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function decideLeave(
  orgSlug: string,
  requestId: string,
  status: 'approved' | 'rejected',
  rejectionNote?: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  if (!isManager(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only managers can decide leave requests.' }
  }

  const parsed = leaveDecisionSchema.safeParse({
    request_id: requestId,
    status,
    rejection_note: rejectionNote || null,
  })

  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid decision.' }
  }

  const supabase = createClient()

  try {
    // Approving your own leave is a conflict of interest, and the reason
    // managers exist. Blocked here because RLS cannot express "not yourself".
    const { data: request } = await supabase
      .from('leave_requests')
      .select('status, employee:employees!leave_requests_employee_id_fkey(user_id)')
      .eq('id', requestId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!request) return { ok: false, code: 'NOT_FOUND', message: 'That request was not found.' }

    const employee = Array.isArray(request.employee) ? request.employee[0] : request.employee
    if (employee?.user_id === auth.userId && !isAdmin(auth.orgRole)) {
      return { ok: false, code: 'FORBIDDEN', message: 'You cannot decide your own leave request.' }
    }

    if (request.status !== 'pending') {
      return { ok: false, code: 'INVALID_STATUS', message: 'That request is already decided.' }
    }

    const { error } = await supabase
      .from('leave_requests')
      .update({
        status: parsed.data.status,
        approved_by: auth.userId,
        approved_at: new Date().toISOString(),
        rejection_note: parsed.data.rejection_note,
      })
      .eq('id', requestId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(`${teamPath(orgSlug)}/leave`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function cancelLeave(
  orgSlug: string,
  requestId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  const supabase = createClient()

  try {
    // RLS already limits this to the filer's own pending requests; scoping by
    // org here is the explicit second layer, not a substitute for it.
    const { error } = await supabase
      .from('leave_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
      .eq('organization_id', auth.orgId)
      .eq('status', 'pending')

    if (error) throw error

    revalidatePath(`${teamPath(orgSlug)}/leave`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
