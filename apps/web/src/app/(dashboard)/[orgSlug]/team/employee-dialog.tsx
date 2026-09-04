'use client'

import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES } from '@pm/shared/constants'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from '@pm/ui'
import { AlertCircle, UserCog, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Field, SelectField } from '@/components/settings/settings-form'
import { saveEmployee } from './actions'

export interface EmployeeRecord {
  id: string
  userId: string
  fullName: string
  employeeCode: string | null
  department: string | null
  designation: string | null
  employmentType: string
  dateOfJoining: string
  dateOfExit: string | null
  managerId: string | null
  skills: string[]
  status: string
}

export interface PersonOption {
  userId: string
  fullName: string
}

function SubmitButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {isNew ? 'Add employee' : 'Save changes'}
    </Button>
  )
}

/**
 * Create or edit an employee record.
 *
 * The person is chosen from existing org members rather than typed: an employee
 * record extends a membership, so one cannot exist without the other.
 */
export function EmployeeDialog({
  orgSlug,
  employee,
  candidates,
  managers,
}: {
  orgSlug: string
  /** Absent when adding. */
  employee?: EmployeeRecord
  candidates: PersonOption[]
  managers: { id: string; fullName: string }[]
}) {
  const [open, setOpen] = useState(false)
  const isNew = !employee
  const [state, formAction] = useFormState(
    saveEmployee.bind(null, orgSlug, employee?.id ?? null),
    null,
  )
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      toast({ title: isNew ? 'Employee added' : 'Employee updated' })
      router.refresh()
    }
  }, [state, router, isNew])

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  // Someone cannot be their own manager; the trigger refuses it too.
  const managerOptions = managers.filter((manager) => manager.id !== employee?.id)

  return (
    <>
      {isNew ? (
        <Button size="sm" onClick={() => setOpen(true)} disabled={candidates.length === 0}>
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          Add employee
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${employee.fullName}`}
          onClick={() => setOpen(true)}
        >
          <UserCog className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isNew ? 'Add an employee' : employee.fullName}</DialogTitle>
            <DialogDescription>
              HR details for someone who is already a member of this organization.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            {state && !state.ok && !state.fieldErrors ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            {isNew ? (
              <Field id="user_id" label="Person" error={fieldError('user_id')}>
                <SelectField
                  id="user_id"
                  name="user_id"
                  options={candidates.map((person) => ({
                    value: person.userId,
                    label: person.fullName,
                  }))}
                />
              </Field>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="employee_code" label="Employee code" error={fieldError('employee_code')}>
                <Input
                  id="employee_code"
                  name="employee_code"
                  defaultValue={employee?.employeeCode ?? ''}
                  maxLength={40}
                  placeholder="EMP-001"
                />
              </Field>
              <Field id="designation" label="Designation">
                <Input
                  id="designation"
                  name="designation"
                  defaultValue={employee?.designation ?? ''}
                  maxLength={80}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="department" label="Department">
                <Input
                  id="department"
                  name="department"
                  defaultValue={employee?.department ?? ''}
                  maxLength={80}
                />
              </Field>
              <Field id="employment_type" label="Employment type">
                <SelectField
                  id="employment_type"
                  name="employment_type"
                  defaultValue={employee?.employmentType ?? 'full_time'}
                  options={EMPLOYMENT_TYPES.map((type) => ({
                    value: type,
                    label: type.replace('_', ' '),
                  }))}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="date_of_joining"
                label="Date of joining"
                error={fieldError('date_of_joining')}
              >
                <Input
                  id="date_of_joining"
                  name="date_of_joining"
                  type="date"
                  required
                  defaultValue={employee?.dateOfJoining ?? ''}
                />
              </Field>
              <Field id="date_of_exit" label="Date of exit" error={fieldError('date_of_exit')}>
                <Input
                  id="date_of_exit"
                  name="date_of_exit"
                  type="date"
                  defaultValue={employee?.dateOfExit ?? ''}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="manager_id" label="Reports to" error={fieldError('manager_id')}>
                <SelectField
                  id="manager_id"
                  name="manager_id"
                  defaultValue={employee?.managerId ?? ''}
                  options={[
                    { value: '', label: 'No manager' },
                    ...managerOptions.map((manager) => ({
                      value: manager.id,
                      label: manager.fullName,
                    })),
                  ]}
                />
              </Field>
              <Field id="status" label="Status">
                <SelectField
                  id="status"
                  name="status"
                  defaultValue={employee?.status ?? 'active'}
                  options={EMPLOYEE_STATUSES.map((status) => ({
                    value: status,
                    label: status.replace('_', ' '),
                  }))}
                />
              </Field>
            </div>

            <Field
              id="skills"
              label="Skills"
              hint="Comma separated. Used by skill-based auto-assignment."
            >
              <Input
                id="skills"
                name="skills"
                defaultValue={employee?.skills.join(', ') ?? ''}
                placeholder="react, postgres, design"
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton isNew={isNew} />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
