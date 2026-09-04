'use server'

import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  validateContactRows,
  validateTaskRows,
  type RowError,
} from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { parseCsvTable } from '@pm/shared/utils'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { enforceRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

/**
 * CSV import (§20 Phase 2, §6.7).
 *
 * Two steps, and the split matters: `inspectCsv` parses and validates without
 * writing anything, so the person sees exactly what will happen — how many rows
 * are good, which are not, and why — before committing. An importer that
 * reports its problems after writing half the file is the thing to avoid.
 *
 * Validation itself is pure and lives in @pm/shared, so the preview and the
 * commit cannot disagree about what is valid.
 *
 * Rows are validated as a set and inserted as a set. A row that fails is
 * reported and skipped; it does not abandon the rest of the file.
 */

export interface CsvPreview {
  headers: string[]
  sample: Record<string, string>[]
  totalRows: number
  /** Base64 of the file, handed back so the commit step re-reads the same bytes. */
  payload: string
}

const MAX_CSV_BYTES = 5 * 1024 * 1024

async function assertManager(orgSlug: string) {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) {
    throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', status: 403 })
  }
  return auth
}

/** Read and preview a file without writing anything. */
export async function inspectCsv(
  orgSlug: string,
  _prev: ActionResult<CsvPreview> | null,
  formData: FormData,
): Promise<ActionResult<CsvPreview>> {
  try {
    await assertManager(orgSlug)

    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Choose a CSV file.' }
    }
    if (file.size > MAX_CSV_BYTES) {
      return { ok: false, code: 'FILE_TOO_LARGE', message: 'That file is larger than 5 MB.' }
    }

    const text = await file.text()
    const table = parseCsvTable(text)

    if (table.headers.length === 0) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'That file has no header row.' }
    }
    if (table.rows.length === 0) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'That file has a header but no rows.' }
    }
    if (table.rows.length > MAX_IMPORT_ROWS) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: `That file has ${table.rows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it and import in parts.`,
      }
    }

    return {
      ok: true,
      data: {
        headers: table.headers,
        // Enough to recognise the file, not enough to make the payload large.
        sample: table.rows.slice(0, 5),
        totalRows: table.rows.length,
        payload: Buffer.from(text, 'utf8').toString('base64'),
      },
    }
  } catch (error) {
    return toActionError(error)
  }
}

export interface ImportResult {
  imported: number
  failed: number
  errors: RowError[]
}

export async function commitImport(
  orgSlug: string,
  entity: 'tasks' | 'contacts',
  projectId: string | null,
  payload: string,
  mapping: Record<string, string>,
): Promise<ActionResult<ImportResult>> {
  try {
    const auth = await assertManager(orgSlug)
    // An import is a bulk write; the export limiter's shape fits it (§13.7).
    await enforceRateLimit('export', `import:${auth.orgId}`)

    const supabase = createClient()
    const text = Buffer.from(payload, 'base64').toString('utf8')
    const table = parseCsvTable(text)

    if (table.rows.length === 0) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Nothing to import.' }
    }
    if (table.rows.length > MAX_IMPORT_ROWS) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'That file is too large to import.' }
    }

    for (const requiredField of IMPORT_FIELDS[entity].filter((f) => f.required)) {
      if (!mapping[requiredField.key]) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: `${requiredField.label} has no column mapped to it.`,
        }
      }
    }

    const { data: job } = await supabase
      .from('import_export_jobs')
      .insert({
        organization_id: auth.orgId,
        type: 'import',
        entity_type: entity,
        started_by: auth.userId,
        status: 'processing',
        started_at: new Date().toISOString(),
        config: { mapping, project_id: projectId } as never,
      })
      .select('id')
      .single()

    const finish = async (status: 'completed' | 'failed', result: Record<string, unknown>) => {
      if (!job) return
      await supabase.rpc('finish_transfer_job', {
        p_job: job.id,
        p_status: status,
        p_result: result as never,
      })
    }

    let imported = 0
    let errors: RowError[] = []

    if (entity === 'tasks') {
      if (!projectId) {
        await finish('failed', { reason: 'No project chosen' })
        return { ok: false, code: 'VALIDATION_ERROR', message: 'Choose a project to import into.' }
      }

      // The project must be in the caller's org. RLS would refuse the insert
      // anyway, but failing here names the reason instead of returning a
      // hundred identical row errors.
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('organization_id', auth.orgId)
        .maybeSingle()

      if (!project) {
        await finish('failed', { reason: 'Project not found' })
        return { ok: false, code: 'NOT_FOUND', message: 'That project no longer exists.' }
      }

      const outcome = validateTaskRows(table.rows, mapping)
      errors = outcome.errors

      // Assignees are named by email. `profiles` has no email column — they
      // live in auth.users, which PostgREST cannot reach — so this goes through
      // org_member_ids_for_emails (00030), which resolves only members of this
      // org. One call, not one per row. An email belonging to someone outside
      // the org simply leaves that task unassigned rather than failing the row.
      const emails = [...new Set(outcome.valid.map((row) => row.assignee_email).filter(Boolean))]
      const byEmail = new Map<string, string>()

      if (emails.length > 0) {
        const { data } = await supabase.rpc('org_member_ids_for_emails', {
          p_emails: emails as string[],
        })
        // The generator types a RETURNS TABLE function as `unknown`; the shape
        // is fixed by the migration, so it is asserted here rather than left
        // untyped at every use.
        const resolved = (data ?? []) as { email: string; user_id: string }[]
        for (const entry of resolved) byEmail.set(entry.email, entry.user_id)
      }

      // The board's first column, so imported tasks land somewhere visible
      // (business rule 3 — the column carries the status).
      const { data: board } = await supabase
        .from('kanban_boards')
        .select('id')
        .eq('project_id', projectId)
        .eq('is_default', true)
        .maybeSingle()

      const columnByStatus = new Map<string, string>()
      if (board) {
        const { data: columns } = await supabase
          .from('kanban_columns')
          .select('id, status')
          .eq('board_id', board.id)
        for (const column of columns ?? []) columnByStatus.set(column.status, column.id)
      }

      if (outcome.valid.length > 0) {
        const { error, count } = await supabase
          .from('tasks')
          .insert(
            outcome.valid.map((row) => ({
              organization_id: auth.orgId,
              project_id: projectId,
              title: row.title,
              status: row.status,
              priority: row.priority,
              start_date: row.start_date,
              due_date: row.due_date,
              estimated_hours: row.estimated_hours,
              assignee_id: row.assignee_email ? (byEmail.get(row.assignee_email) ?? null) : null,
              kanban_column_id: columnByStatus.get(row.status) ?? null,
              created_by: auth.userId,
            })) as never,
            { count: 'exact' },
          )

        if (error) {
          await finish('failed', { rows_processed: 0, error: error.message })
          return { ok: false, code: 'INTERNAL_ERROR', message: 'The import could not be saved.' }
        }
        imported = count ?? outcome.valid.length
      }
    } else {
      const outcome = validateContactRows(table.rows, mapping)
      errors = outcome.errors

      if (outcome.valid.length > 0) {
        const { error, count } = await supabase
          .from('contacts')
          .insert(
            outcome.valid.map((row) => ({
              organization_id: auth.orgId,
              contact_name: row.contact_name,
              company_name: row.company_name,
              type: row.type,
              email: row.email,
              phone: row.phone,
              tax_id: row.tax_id,
              notes: row.notes,
              address: row.address as never,
              created_by: auth.userId,
            })) as never,
            { count: 'exact' },
          )

        if (error) {
          await finish('failed', { rows_processed: 0, error: error.message })
          return { ok: false, code: 'INTERNAL_ERROR', message: 'The import could not be saved.' }
        }
        imported = count ?? outcome.valid.length
      }
    }

    await finish('completed', {
      rows_processed: imported,
      rows_failed: errors.length,
      // Capped: a file where every row failed would otherwise store thousands
      // of messages in a jsonb column nobody reads past the first screen.
      errors: errors.slice(0, 50),
    })

    revalidatePath(`/${orgSlug}/settings/data`)
    return { ok: true, data: { imported, failed: errors.length, errors: errors.slice(0, 100) } }
  } catch (error) {
    return toActionError(error)
  }
}
