'use client'

import {
  IMPORTABLE_ENTITIES,
  IMPORT_FIELDS,
  TRANSFER_ENTITY_LABELS,
  guessMapping,
  type TransferEntity,
} from '@pm/shared/constants'
import { Alert, AlertDescription, Button, toast } from '@pm/ui'
import { AlertCircle, Check, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { commitImport, inspectCsv, type ImportResult } from './actions'

interface Project {
  id: string
  name: string
}

function InspectButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" loading={pending}>
      <Upload className="h-3.5 w-3.5" aria-hidden />
      Read file
    </Button>
  )
}

/**
 * Import in two visible steps.
 *
 * The file is read and previewed before anything is written, and the column
 * mapping is shown as a guess that can be corrected — a wrong guess that
 * imports silently is worse than no guess. Nothing is inserted until the second
 * button.
 */
export function ImportPanel({
  orgSlug,
  projects,
}: {
  orgSlug: string
  projects: Project[]
}) {
  const [entity, setEntity] = useState<'tasks' | 'contacts'>('tasks')
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [preview, formAction] = useFormState(inspectCsv.bind(null, orgSlug), null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const fields = IMPORT_FIELDS[entity]

  // Re-guess whenever the file or the target entity changes; the previous
  // mapping refers to headers that may no longer exist.
  useEffect(() => {
    if (preview?.ok) setMapping(guessMapping(preview.data.headers, IMPORT_FIELDS[entity]))
    setResult(null)
  }, [preview, entity])

  const missingRequired = fields.filter((field) => field.required && !mapping[field.key])

  const run = () => {
    if (!preview?.ok) return
    startTransition(async () => {
      const outcome = await commitImport(
        orgSlug,
        entity,
        entity === 'tasks' ? projectId : null,
        preview.data.payload,
        mapping,
      )
      if (outcome.ok) {
        setResult(outcome.data)
        router.refresh()
      } else {
        toast({ title: outcome.message, variant: 'destructive' })
      }
    })
  }

  return (
    <section className="rounded-lg border border-border bg-surface shadow-card">
      <header className="border-b border-border-subtle px-5 py-4">
        <h2 className="text-ui font-semibold">Import from CSV</h2>
        <p className="pt-1 text-base text-muted-foreground">
          The file is read and checked before anything is saved.
        </p>
      </header>

      <div className="space-y-5 px-5 py-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label htmlFor="import-entity" className="label-meta block pb-1.5 text-faint">
              Import
            </label>
            <select
              id="import-entity"
              value={entity}
              onChange={(event) => setEntity(event.target.value as 'tasks' | 'contacts')}
              className="h-9 w-full rounded-md border border-border bg-card px-3 text-base"
            >
              {IMPORTABLE_ENTITIES.map((value) => (
                <option key={value} value={value}>
                  {TRANSFER_ENTITY_LABELS[value as TransferEntity]}
                </option>
              ))}
            </select>
          </div>

          {entity === 'tasks' ? (
            <div className="w-56">
              <label htmlFor="import-project" className="label-meta block pb-1.5 text-faint">
                Into project
              </label>
              <select
                id="import-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-base"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="import-file" className="label-meta block pb-1.5 text-faint">
              CSV file
            </label>
            <input
              id="import-file"
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="block w-full text-base file:me-3 file:rounded-md file:border-0 file:bg-card file:px-3 file:py-1.5 file:text-base file:text-foreground"
            />
          </div>
          <InspectButton />
        </form>

        {preview && !preview.ok ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{preview.message}</AlertDescription>
          </Alert>
        ) : null}

        {preview?.ok ? (
          <>
            <p className="text-base text-muted-foreground">
              {preview.data.totalRows} row{preview.data.totalRows === 1 ? '' : 's'} found.
              Check the column mapping below.
            </p>

            <div className="space-y-2">
              {fields.map((field) => (
                <div key={field.key} className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor={`map-${field.key}`}
                    className="w-40 shrink-0 text-base"
                  >
                    {field.label}
                    {field.required ? <span className="text-destructive"> *</span> : null}
                  </label>
                  <select
                    id={`map-${field.key}`}
                    value={mapping[field.key] ?? ''}
                    onChange={(event) =>
                      setMapping((current) => {
                        const next = { ...current }
                        if (event.target.value) next[field.key] = event.target.value
                        else delete next[field.key]
                        return next
                      })
                    }
                    className="h-8 w-56 rounded-md border border-border bg-card px-2 text-base"
                  >
                    <option value="">— not imported —</option>
                    {preview.data.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                  {field.hint ? (
                    <span className="text-nav text-faint">{field.hint}</span>
                  ) : null}
                </div>
              ))}
            </div>

            {missingRequired.length > 0 ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>
                  Map a column to {missingRequired.map((field) => field.label).join(', ')}.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border-subtle">
                    {preview.data.headers.map((header) => (
                      <th key={header} className="label-meta px-3 py-2 text-start text-faint">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.data.sample.map((row, index) => (
                    // Sample rows have no id and never reorder.
                    // eslint-disable-next-line react/no-array-index-key
                    <tr key={index} className="border-b border-border-subtle last:border-0">
                      {preview.data.headers.map((header) => (
                        <td key={header} className="max-w-48 truncate px-3 py-1.5 text-muted-foreground">
                          {row[header]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button
              type="button"
              size="sm"
              loading={pending}
              disabled={missingRequired.length > 0 || (entity === 'tasks' && !projectId)}
              onClick={run}
            >
              Import {preview.data.totalRows} row{preview.data.totalRows === 1 ? '' : 's'}
            </Button>
          </>
        ) : null}

        {result ? (
          <Alert variant={result.failed > 0 ? 'destructive' : 'success'}>
            {result.failed > 0 ? <AlertCircle aria-hidden /> : <Check aria-hidden />}
            <AlertDescription>
              <p>
                Imported {result.imported} row{result.imported === 1 ? '' : 's'}
                {result.failed > 0 ? `, skipped ${result.failed}.` : '.'}
              </p>
              {result.errors.length > 0 ? (
                <ul className="max-h-40 overflow-y-auto pt-2 font-mono text-[11px]">
                  {result.errors.map((rowError) => (
                    <li key={rowError.row}>
                      Row {rowError.row}: {rowError.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  )
}
