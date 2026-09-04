/**
 * Import / export definitions (§6.7, §20 Phase 2).
 *
 * One place says what a CSV of each entity looks like, so the exporter, the
 * importer and the column-mapping UI cannot disagree about it. Everything here
 * is data and pure functions — the queries and inserts live in the app.
 *
 * Exportable and importable are deliberately different sets. An export shows
 * derived and joined values that are useful to read (project name, assignee
 * name, task number); an import accepts only the fields a row actually owns.
 * Letting an import write `task_number` or a joined name would either be
 * ignored silently or corrupt data the database maintains.
 */

export const TRANSFER_ENTITIES = ['tasks', 'contacts', 'projects'] as const
export type TransferEntity = (typeof TRANSFER_ENTITIES)[number]

export const TRANSFER_ENTITY_LABELS: Record<TransferEntity, string> = {
  tasks: 'Tasks',
  contacts: 'Contacts',
  projects: 'Projects',
}

/** Entities an import can create. Projects are export-only — see below. */
export const IMPORTABLE_ENTITIES: readonly TransferEntity[] = ['tasks', 'contacts']

export interface ExportColumn {
  key: string
  label: string
}

export const EXPORT_COLUMNS: Record<TransferEntity, ExportColumn[]> = {
  tasks: [
    { key: 'reference', label: 'Reference' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'project', label: 'Project' },
    { key: 'assignee', label: 'Assignee' },
    { key: 'start_date', label: 'Start date' },
    { key: 'due_date', label: 'Due date' },
    { key: 'estimated_hours', label: 'Estimated hours' },
    { key: 'labels', label: 'Labels' },
    { key: 'created_at', label: 'Created' },
    { key: 'completed_at', label: 'Completed' },
  ],
  contacts: [
    { key: 'contact_name', label: 'Contact name' },
    { key: 'company_name', label: 'Company' },
    { key: 'type', label: 'Type' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'tax_id', label: 'Tax ID' },
    { key: 'street', label: 'Street' },
    { key: 'city', label: 'City' },
    { key: 'country', label: 'Country' },
    { key: 'notes', label: 'Notes' },
    { key: 'created_at', label: 'Created' },
  ],
  projects: [
    { key: 'name', label: 'Name' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'start_date', label: 'Start date' },
    { key: 'end_date', label: 'End date' },
    { key: 'task_count', label: 'Tasks' },
    { key: 'created_at', label: 'Created' },
  ],
}

export interface ImportField {
  key: string
  label: string
  required: boolean
  /** Header names matched case-insensitively when guessing the mapping. */
  aliases: string[]
  hint?: string
}

export const IMPORT_FIELDS: Record<'tasks' | 'contacts', ImportField[]> = {
  tasks: [
    { key: 'title', label: 'Title', required: true, aliases: ['name', 'summary', 'task'] },
    {
      key: 'status',
      label: 'Status',
      required: false,
      aliases: ['state'],
      hint: 'todo, in_progress, in_review, done, cancelled',
    },
    {
      key: 'priority',
      label: 'Priority',
      required: false,
      aliases: [],
      hint: 'critical, high, medium, low',
    },
    { key: 'assignee_email', label: 'Assignee email', required: false, aliases: ['assignee', 'owner'] },
    { key: 'start_date', label: 'Start date', required: false, aliases: ['start'] },
    { key: 'due_date', label: 'Due date', required: false, aliases: ['due', 'deadline'] },
    {
      key: 'estimated_hours',
      label: 'Estimated hours',
      required: false,
      aliases: ['estimate', 'hours'],
    },
  ],
  contacts: [
    { key: 'contact_name', label: 'Contact name', required: true, aliases: ['name', 'contact'] },
    { key: 'company_name', label: 'Company', required: false, aliases: ['organisation', 'organization', 'company name'] },
    { key: 'type', label: 'Type', required: false, aliases: [], hint: 'client, vendor, both' },
    { key: 'email', label: 'Email', required: false, aliases: ['e-mail', 'email address'] },
    { key: 'phone', label: 'Phone', required: false, aliases: ['telephone', 'mobile'] },
    { key: 'tax_id', label: 'Tax ID', required: false, aliases: ['vat', 'tax number'] },
    { key: 'street', label: 'Street', required: false, aliases: ['address'] },
    { key: 'city', label: 'City', required: false, aliases: [] },
    { key: 'country', label: 'Country', required: false, aliases: [] },
    { key: 'notes', label: 'Notes', required: false, aliases: ['description'] },
  ],
}

const normalise = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, ' ')

/**
 * Guess which CSV column feeds which field.
 *
 * A first pass over exact label matches, then aliases, then a contains match.
 * Only ever a suggestion — the UI shows the result and lets it be changed,
 * because a wrong guess that imports silently is worse than no guess at all.
 * A header is used at most once, so two fields cannot claim the same column.
 */
export function guessMapping(
  headers: readonly string[],
  fields: readonly ImportField[],
): Record<string, string> {
  const mapping: Record<string, string> = {}
  const taken = new Set<string>()

  const claim = (fieldKey: string, header: string) => {
    mapping[fieldKey] = header
    taken.add(header)
  }

  const findBy = (test: (header: string, field: ImportField) => boolean) => {
    for (const field of fields) {
      if (mapping[field.key]) continue
      const hit = headers.find((header) => !taken.has(header) && test(header, field))
      if (hit) claim(field.key, hit)
    }
  }

  findBy((header, field) => normalise(header) === normalise(field.label))
  findBy((header, field) => normalise(header) === normalise(field.key))
  findBy((header, field) => field.aliases.some((alias) => normalise(alias) === normalise(header)))
  findBy((header, field) => {
    const h = normalise(header)
    const l = normalise(field.label)
    // Guard against a one-letter field matching half the file.
    return l.length > 3 && (h.includes(l) || l.includes(h))
  })

  return mapping
}

export interface RowError {
  /** 1-based, counting the header as row 1, so it matches what a spreadsheet shows. */
  row: number
  message: string
}

export interface ImportOutcome<T> {
  valid: T[]
  errors: RowError[]
}

/** Cap on a single import. Beyond this the request would outlive its timeout. */
export const MAX_IMPORT_ROWS = 2000
