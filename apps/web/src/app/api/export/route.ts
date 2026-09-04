import {
  EXPORT_COLUMNS,
  TRANSFER_ENTITIES,
  type TransferEntity,
} from '@pm/shared/constants'
import { toCsv } from '@pm/shared/utils'
import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth/context'
import { checkRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

/**
 * CSV export (§20 Phase 2, §13.7).
 *
 * A route rather than a server action because the response is a file.
 *
 * Everything is read through the RLS-scoped client, so the export contains
 * exactly what this person can already see — an export must never be a way
 * around a policy. That is also why there is no service-role path here even
 * though it would be faster.
 *
 * Rate limited on the org, not the user: §13.7 defines the `export` limiter at
 * 5 per 10 minutes precisely because a bulk read is the expensive request, and
 * five people in one tenant each pulling every task is the same load as one
 * person doing it five times.
 *
 * Synchronous, with a row cap. `import_export_jobs` describes an async job with
 * a `file_path`, and at some volume that is the right shape — a background job
 * writing to Storage and handing back a signed URL. At the volumes a single
 * organisation actually holds, streaming the response is simpler and gives an
 * immediate download; the cap is what keeps that honest.
 */

export const runtime = 'nodejs'

/** Beyond this an export belongs in a background job, not a request. */
const MAX_EXPORT_ROWS = 10_000

const one = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

export async function GET(request: NextRequest) {
  const orgSlug = request.nextUrl.searchParams.get('org')
  const entity = request.nextUrl.searchParams.get('entity') as TransferEntity | null

  if (!orgSlug || !entity || !(TRANSFER_ENTITIES as readonly string[]).includes(entity)) {
    return NextResponse.json({ error: 'Unknown export', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const auth = await getAuthContext(orgSlug)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  const limit = await checkRateLimit('export', `export:${auth.orgId}`)
  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many exports. Try again shortly.', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  const supabase = createClient()

  // Recorded before the work, so a failed export still leaves a trace of who
  // asked for what (§13.11).
  const { data: job } = await supabase
    .from('import_export_jobs')
    .insert({
      organization_id: auth.orgId,
      type: 'export',
      entity_type: entity,
      started_by: auth.userId,
      status: 'processing',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  const finish = async (status: 'completed' | 'failed', result: Record<string, unknown>) => {
    if (!job) return
    await supabase.rpc('finish_transfer_job', {
      p_job: job.id,
      p_status: status,
      // Json is a recursive union; a Record<string, unknown> is structurally
      // compatible but TypeScript cannot prove it without the cast.
      p_result: result as never,
    })
  }

  let rows: Record<string, unknown>[] = []

  try {
    if (entity === 'tasks') {
      const { data, error } = await supabase
        .from('tasks')
        .select(
          `title, status, priority, start_date, due_date, estimated_hours, task_number,
           created_at, completed_at,
           project:projects!tasks_project_id_fkey(name),
           assignee:profiles!tasks_assignee_id_fkey(full_name),
           task_labels(label:labels(name))`,
        )
        .eq('organization_id', auth.orgId)
        .order('created_at', { ascending: false })
        .limit(MAX_EXPORT_ROWS)

      if (error) throw error

      rows = (data ?? []).map((task) => {
        const project = one(task.project) as { name: string } | null
        return {
          // A bare number is meaningless out of context; the project name makes
          // the reference readable in a spreadsheet.
          reference: project ? `${project.name} #${task.task_number}` : `#${task.task_number}`,
          title: task.title,
          status: task.status,
          priority: task.priority,
          project: project?.name ?? '',
          assignee: (one(task.assignee) as { full_name: string } | null)?.full_name ?? '',
          start_date: task.start_date ?? '',
          due_date: task.due_date ?? '',
          estimated_hours: task.estimated_hours ?? '',
          labels: (task.task_labels ?? [])
            .map((entry) => (one(entry.label) as { name: string } | null)?.name)
            .filter(Boolean)
            .join(', '),
          created_at: task.created_at,
          completed_at: task.completed_at ?? '',
        }
      })
    } else if (entity === 'contacts') {
      const { data, error } = await supabase
        .from('contacts')
        .select('contact_name, company_name, type, email, phone, tax_id, address, notes, created_at')
        .eq('organization_id', auth.orgId)
        .order('contact_name')
        .limit(MAX_EXPORT_ROWS)

      if (error) throw error

      rows = (data ?? []).map((contact) => {
        const address = (contact.address ?? {}) as Record<string, unknown>
        return {
          contact_name: contact.contact_name,
          company_name: contact.company_name ?? '',
          type: contact.type,
          email: contact.email ?? '',
          phone: contact.phone ?? '',
          tax_id: contact.tax_id ?? '',
          street: typeof address.street === 'string' ? address.street : '',
          city: typeof address.city === 'string' ? address.city : '',
          country: typeof address.country === 'string' ? address.country : '',
          notes: contact.notes ?? '',
          created_at: contact.created_at,
        }
      })
    } else {
      const { data, error } = await supabase
        .from('projects')
        .select(
          `name, status, priority, start_date, end_date, created_at,
           workspace:workspaces!projects_workspace_id_fkey(name),
           tasks(count)`,
        )
        .eq('organization_id', auth.orgId)
        .order('name')
        .limit(MAX_EXPORT_ROWS)

      if (error) throw error

      rows = (data ?? []).map((project) => ({
        name: project.name,
        workspace: (one(project.workspace) as { name: string } | null)?.name ?? '',
        status: project.status,
        priority: project.priority ?? '',
        start_date: project.start_date ?? '',
        end_date: project.end_date ?? '',
        task_count: one(project.tasks as unknown as { count: number }[])?.count ?? 0,
        created_at: project.created_at,
      }))
    }
  } catch {
    await finish('failed', { rows_processed: 0, error: 'Query failed' })
    // The reason is deliberately generic (§16): the caller learns the export
    // failed, not what the database said.
    return NextResponse.json({ error: 'Export failed', code: 'INTERNAL_ERROR' }, { status: 500 })
  }

  const truncated = rows.length >= MAX_EXPORT_ROWS
  await finish('completed', { rows_processed: rows.length, truncated })

  const csv = toCsv(rows, EXPORT_COLUMNS[entity])
  const filename = `${orgSlug}-${entity}-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    headers: {
      // charset matters: without it Excel mis-decodes non-ASCII names.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      ...(truncated ? { 'X-Export-Truncated': String(MAX_EXPORT_ROWS) } : {}),
    },
  })
}
