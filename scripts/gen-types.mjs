#!/usr/bin/env node
/**
 * Offline type generator.
 *
 * `supabase gen types typescript` is the primary path, but it shells out to a
 * container even when given --db-url, so it cannot run without Docker. This
 * script introspects any Postgres connection directly and emits the same
 * `Database` shape the Supabase client expects.
 *
 *   node scripts/gen-types.mjs "postgres://..." --out packages/db/src/types.ts
 *
 * Prefer --out over `>`. The shell truncates the target before the command
 * runs, so a generator that fails for any reason — an unreachable database, a
 * missing `supabase link` — leaves an empty types.ts behind. That is not a
 * loud failure: the Supabase client silently degrades to `any`, local
 * typecheck still passes, and the build breaks later with an unrelated-looking
 * "implicitly has an 'any' type" in whichever file happens to map over a
 * relation. It has already cost one failed production deploy.
 *
 * Keep the two in sync: if the official generator's output ever differs, it wins.
 */
import { renameSync, writeFileSync } from 'node:fs'

import './load-env.mjs'
import pg from 'pg'

const connectionString = process.argv[2] ?? process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('Usage: node scripts/gen-types.mjs <postgres-connection-string>')
  process.exit(1)
}

/** Postgres type -> TypeScript type. Anything unmapped falls back to `string`. */
const TYPE_MAP = {
  bool: 'boolean',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  float4: 'number',
  float8: 'number',
  numeric: 'number',
  json: 'Json',
  jsonb: 'Json',
  uuid: 'string',
  text: 'string',
  varchar: 'string',
  bpchar: 'string',
  date: 'string',
  time: 'string',
  timetz: 'string',
  timestamp: 'string',
  timestamptz: 'string',
  bytea: 'string',
}

/**
 * Types the official generator leaves as `unknown` rather than guessing a
 * TypeScript shape. Mapping them to `string` here would be more convenient but
 * would make this generator's output differ from `supabase gen types`, and CI
 * compares the two byte for byte.
 */
const UNKNOWN_TYPES = new Set(['inet', 'cidr', 'macaddr', 'interval', 'tsvector'])

function tsType(udtName, isArray) {
  const name = udtName.replace(/^_/, '')
  const base = UNKNOWN_TYPES.has(name) ? 'unknown' : (TYPE_MAP[name] ?? 'string')
  return isArray ? `${base}[]` : base
}

const client = new pg.Client({ connectionString })
await client.connect()

const { rows: columns } = await client.query(`
  SELECT
    c.relname                                        AS table_name,
    c.relkind                                        AS kind,
    a.attname                                        AS column_name,
    a.attnum                                         AS ordinal,
    t.typname                                        AS udt_name,
    a.attndims > 0 OR t.typcategory = 'A'            AS is_array,
    NOT a.attnotnull                                 AS is_nullable,
    pg_get_expr(d.adbin, d.adrelid) IS NOT NULL      AS has_default,
    a.attidentity <> ''                              AS is_identity,
    a.attgenerated <> ''                             AS is_generated
  FROM pg_attribute a
  JOIN pg_class c      ON c.oid = a.attrelid
  JOIN pg_namespace n  ON n.oid = c.relnamespace
  JOIN pg_type t       ON t.oid = a.atttypid
  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'v', 'm')
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY c.relname, a.attnum;
`)

const { rows: foreignKeys } = await client.query(`
  SELECT
    con.conname                    AS constraint_name,
    src.relname                    AS table_name,
    srcatt.attname                 AS column_name,
    tgt.relname                    AS foreign_table,
    tgtatt.attname                 AS foreign_column
  FROM pg_constraint con
  JOIN pg_class src     ON src.oid = con.conrelid
  JOIN pg_class tgt     ON tgt.oid = con.confrelid
  JOIN pg_namespace n   ON n.oid = src.relnamespace
  JOIN unnest(con.conkey)  WITH ORDINALITY AS sk(attnum, ord) ON true
  JOIN unnest(con.confkey) WITH ORDINALITY AS tk(attnum, ord) ON tk.ord = sk.ord
  JOIN pg_attribute srcatt ON srcatt.attrelid = src.oid AND srcatt.attnum = sk.attnum
  JOIN pg_attribute tgtatt ON tgtatt.attrelid = tgt.oid AND tgtatt.attnum = tk.attnum
  WHERE con.contype = 'f' AND n.nspname = 'public'
  ORDER BY src.relname, con.conname;
`)

// Only functions defined by our migrations, not those pulled in by extensions.
const { rows: functions } = await client.query(`
  SELECT
    p.proname                                   AS name,
    pg_get_function_arguments(p.oid)            AS args,
    pg_get_function_result(p.oid)               AS returns
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
  WHERE n.nspname = 'public'
    AND d.objid IS NULL
    AND p.prokind = 'f'
    AND pg_get_function_result(p.oid) <> 'trigger'
  ORDER BY p.proname;
`)

await client.end()

const tables = new Map()
for (const col of columns) {
  if (!tables.has(col.table_name)) {
    tables.set(col.table_name, { kind: col.kind, columns: [] })
  }
  tables.get(col.table_name).columns.push(col)
}

const fksByTable = new Map()
for (const fk of foreignKeys) {
  if (!fksByTable.has(fk.table_name)) fksByTable.set(fk.table_name, [])
  fksByTable.get(fk.table_name).push(fk)
}

const out = []
out.push('// AUTO-GENERATED — do not edit by hand.')
out.push('//')
out.push('// Regenerate with either:')
out.push('//   pnpm db:types           (supabase CLI, requires Docker)')
out.push('//   pnpm db:types:offline   (scripts/gen-types.mjs, any Postgres URL)')
out.push('')
out.push('export type Json =')
out.push('  | string')
out.push('  | number')
out.push('  | boolean')
out.push('  | null')
out.push('  | { [key: string]: Json | undefined }')
out.push('  | Json[]')
out.push('')
out.push('export interface Database {')
out.push('  public: {')

// --- Tables and views ---
const relations = [...tables.entries()].sort(([a], [b]) => a.localeCompare(b))
const baseTables = relations.filter(([, meta]) => meta.kind === 'r')
const views = relations.filter(([, meta]) => meta.kind !== 'r')

function emitRelation(name, meta, indent, includeWrites) {
  const pad = ' '.repeat(indent)
  out.push(`${pad}${name}: {`)

  out.push(`${pad}  Row: {`)
  for (const col of meta.columns) {
    const type = tsType(col.udt_name, col.is_array)
    out.push(`${pad}    ${col.column_name}: ${type}${col.is_nullable ? ' | null' : ''}`)
  }
  out.push(`${pad}  }`)

  if (includeWrites) {
    out.push(`${pad}  Insert: {`)
    for (const col of meta.columns) {
      const type = tsType(col.udt_name, col.is_array)
      // Optional when the database can supply it: default, identity, generated,
      // or simply nullable.
      const optional =
        col.has_default || col.is_identity || col.is_generated || col.is_nullable
      out.push(
        `${pad}    ${col.column_name}${optional ? '?' : ''}: ${type}${col.is_nullable ? ' | null' : ''}`,
      )
    }
    out.push(`${pad}  }`)

    out.push(`${pad}  Update: {`)
    for (const col of meta.columns) {
      const type = tsType(col.udt_name, col.is_array)
      out.push(`${pad}    ${col.column_name}?: ${type}${col.is_nullable ? ' | null' : ''}`)
    }
    out.push(`${pad}  }`)
  }

  const fks = fksByTable.get(name) ?? []
  out.push(`${pad}  Relationships: [`)
  for (const fk of fks) {
    out.push(`${pad}    {`)
    out.push(`${pad}      foreignKeyName: '${fk.constraint_name}'`)
    out.push(`${pad}      columns: ['${fk.column_name}']`)
    out.push(`${pad}      isOneToOne: false`)
    out.push(`${pad}      referencedRelation: '${fk.foreign_table}'`)
    out.push(`${pad}      referencedColumns: ['${fk.foreign_column}']`)
    out.push(`${pad}    },`)
  }
  out.push(`${pad}  ]`)
  out.push(`${pad}}`)
}

out.push('    Tables: {')
for (const [name, meta] of baseTables) emitRelation(name, meta, 6, true)
out.push('    }')

// An empty section must be `{ [_ in never]: never }`, NOT `Record<string, never>`.
// The latter makes every string a valid key, so `.from('tasks')` resolves against
// Views before Tables and the row type collapses to `never`.
const EMPTY_SECTION = '{ [_ in never]: never }'

if (views.length === 0) {
  out.push(`    Views: ${EMPTY_SECTION}`)
} else {
  out.push('    Views: {')
  for (const [name, meta] of views) emitRelation(name, meta, 6, false)
  out.push('    }')
}

// --- Functions (the .rpc() surface) ---
/** Split a pg_get_function_arguments string on top-level commas. */
function splitArgs(signature) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of signature) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Map a SQL type name as it appears in a signature to a TypeScript type. */
function sqlTypeToTs(sqlType) {
  const normalized = sqlType.trim().toLowerCase().replace(/\[\]$/, '')
  const isArray = sqlType.trim().endsWith('[]')
  const map = {
    boolean: 'boolean',
    bool: 'boolean',
    smallint: 'number',
    integer: 'number',
    bigint: 'number',
    numeric: 'number',
    real: 'number',
    'double precision': 'number',
    json: 'Json',
    jsonb: 'Json',
    uuid: 'string',
    text: 'string',
    date: 'string',
    void: 'undefined',
    bytea: 'string',
  }
  let base = map[normalized]
  if (!base) {
    if (normalized.startsWith('character varying') || normalized.startsWith('varchar')) base = 'string'
    else if (normalized.startsWith('timestamp')) base = 'string'
    else if (normalized.startsWith('time')) base = 'string'
    else base = 'unknown'
  }
  return isArray ? `${base}[]` : base
}

function parseReturns(returns) {
  const trimmed = returns.trim()
  if (trimmed.toLowerCase().startsWith('setof ')) {
    const target = trimmed.slice(6).trim()
    if (tables.has(target)) {
      return `Database['public']['Tables']['${target}']['Row'][]`
    }
    return `${sqlTypeToTs(target)}[]`
  }
  if (tables.has(trimmed)) {
    return `Database['public']['Tables']['${trimmed}']['Row']`
  }
  return sqlTypeToTs(trimmed)
}

if (functions.length === 0) {
  out.push(`    Functions: ${EMPTY_SECTION}`)
} else {
  out.push('    Functions: {')
  for (const fn of functions) {
    const args = splitArgs(fn.args ?? '')
      .map((arg) => {
        // "p_delta bigint DEFAULT 1" -> name p_delta, type bigint, optional
        const withoutDefault = arg.split(/\s+DEFAULT\s+/i)[0].trim()
        const hasDefault = /\s+DEFAULT\s+/i.test(arg)
        const spaceIndex = withoutDefault.indexOf(' ')
        if (spaceIndex === -1) return null
        const name = withoutDefault.slice(0, spaceIndex).trim()
        const type = withoutDefault.slice(spaceIndex + 1).trim()
        // Skip OUT/INOUT/VARIADIC markers we do not model.
        if (['out', 'inout', 'variadic'].includes(name.toLowerCase())) return null
        return { name, type, optional: hasDefault }
      })
      .filter(Boolean)

    out.push(`      ${fn.name}: {`)
    if (args.length === 0) {
      out.push('        Args: Record<PropertyKey, never>')
    } else {
      out.push('        Args: {')
      for (const arg of args) {
        out.push(`          ${arg.name}${arg.optional ? '?' : ''}: ${sqlTypeToTs(arg.type)}`)
      }
      out.push('        }')
    }
    out.push(`        Returns: ${parseReturns(fn.returns)}`)
    out.push('      }')
  }
  out.push('    }')
}

out.push(`    Enums: ${EMPTY_SECTION}`)
out.push(`    CompositeTypes: ${EMPTY_SECTION}`)
out.push('  }')
out.push('}')
out.push('')

// --- Convenience aliases ---
out.push('type PublicSchema = Database["public"]')
out.push('')
out.push('export type Tables<T extends keyof PublicSchema["Tables"]> =')
out.push('  PublicSchema["Tables"][T]["Row"]')
out.push('')
out.push('export type TablesInsert<T extends keyof PublicSchema["Tables"]> =')
out.push('  PublicSchema["Tables"][T]["Insert"]')
out.push('')
out.push('export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =')
out.push('  PublicSchema["Tables"][T]["Update"]')
out.push('')
out.push('export type TableName = keyof PublicSchema["Tables"]')
out.push('')

const contents = out.join('\n')

const outFlag = process.argv.indexOf('--out')
if (outFlag === -1) {
  process.stdout.write(contents)
} else {
  const target = process.argv[outFlag + 1]
  if (!target) {
    console.error('--out needs a path')
    process.exit(1)
  }
  // Write beside the target and rename: rename is atomic within a filesystem,
  // so the file is either the old contents or the complete new ones, never
  // empty or half-written.
  const temporary = `${target}.tmp`
  writeFileSync(temporary, contents)
  renameSync(temporary, target)
  console.error(`Wrote ${target} (${contents.length} bytes)`)
}
