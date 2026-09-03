import { describe, expect, it } from 'vitest'
import { AppError } from '../errors'
import { loginSchema, signupSchema } from '../validators/auth'
import { projectCreateSchema } from '../validators/project'
import { taskCreateSchema, taskMoveSchema, commentCreateSchema } from '../validators/task'
import { validateInput } from '../validators/validate'

/** Zod validator tests (claude.md §14: "All Zod validators"). */

describe('auth validators', () => {
  it('normalizes email to lowercase and trims it', () => {
    const parsed = loginSchema.parse({ email: '  Ada@Example.TEST ', password: 'secret' })
    expect(parsed.email).toBe('ada@example.test')
  })

  it('rejects a password under 8 characters', () => {
    const result = signupSchema.safeParse({
      full_name: 'Ada',
      email: 'ada@example.test',
      password: 'short',
      confirm_password: 'short',
      organization_name: 'Acme',
      accept_terms: true,
    })
    expect(result.success).toBe(false)
  })

  it('rejects mismatched password confirmation', () => {
    const result = signupSchema.safeParse({
      full_name: 'Ada',
      email: 'ada@example.test',
      password: 'password123',
      confirm_password: 'password124',
      organization_name: 'Acme',
      accept_terms: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('confirm_password'))).toBe(true)
    }
  })

  it('requires the terms checkbox', () => {
    const base = {
      full_name: 'Ada',
      email: 'ada@example.test',
      password: 'password123',
      confirm_password: 'password123',
      organization_name: 'Acme',
    }
    expect(signupSchema.safeParse({ ...base, accept_terms: false }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, accept_terms: true }).success).toBe(true)
  })
})

describe('project validator', () => {
  const workspaceId = '11111111-1111-1111-1111-111111111111'

  it('rejects an end date before the start date', () => {
    const result = projectCreateSchema.safeParse({
      workspace_id: workspaceId,
      name: 'Website',
      start_date: '2026-06-01',
      end_date: '2026-05-01',
    })
    expect(result.success).toBe(false)
  })

  it('accepts equal start and end dates', () => {
    const result = projectCreateSchema.safeParse({
      workspace_id: workspaceId,
      name: 'Website',
      start_date: '2026-06-01',
      end_date: '2026-06-01',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a blank name', () => {
    expect(
      projectCreateSchema.safeParse({ workspace_id: workspaceId, name: '   ' }).success,
    ).toBe(false)
  })
})

describe('task validators', () => {
  const projectId = '22222222-2222-2222-2222-222222222222'

  it('applies defaults for status and priority', () => {
    const parsed = taskCreateSchema.parse({ project_id: projectId, title: 'Do the thing' })
    expect(parsed.status).toBe('todo')
    expect(parsed.priority).toBe('medium')
    expect(parsed.label_ids).toEqual([])
  })

  it('rejects a due date before the start date', () => {
    const result = taskCreateSchema.safeParse({
      project_id: projectId,
      title: 'Do the thing',
      start_date: '2026-03-10',
      due_date: '2026-03-01',
    })
    expect(result.success).toBe(false)
  })

  it('requires both column and position on a move', () => {
    expect(
      taskMoveSchema.safeParse({ task_id: projectId, target_column_id: projectId }).success,
    ).toBe(false)
  })

  it('requires a comment to have exactly one parent', () => {
    const body = { type: 'doc' }
    expect(commentCreateSchema.safeParse({ body }).success).toBe(false)
    expect(commentCreateSchema.safeParse({ body, task_id: projectId }).success).toBe(true)
    expect(
      commentCreateSchema.safeParse({ body, task_id: projectId, document_id: projectId }).success,
    ).toBe(false)
  })
})

describe('validateInput', () => {
  it('returns the parsed value on success', () => {
    expect(validateInput(loginSchema, { email: 'a@b.test', password: 'x' })).toEqual({
      email: 'a@b.test',
      password: 'x',
    })
  })

  it('throws an AppError with a VALIDATION_ERROR code', () => {
    try {
      validateInput(loginSchema, { email: 'nope', password: '' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('VALIDATION_ERROR')
      expect((error as AppError).status).toBe(400)
    }
  })
})
