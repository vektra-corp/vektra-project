#!/usr/bin/env node
/**
 * Translation completeness check (claude.md §21.8).
 *
 * en.json is the source of truth. Every key present there must exist in every
 * other locale file, or the CI build fails. Extra keys in a locale are reported
 * as warnings — they are usually leftovers from a removed feature.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MESSAGES_DIR = 'apps/web/src/messages'
const SOURCE_LOCALE = 'en'

if (!existsSync(MESSAGES_DIR)) {
  console.error(`No messages directory at ${MESSAGES_DIR}`)
  process.exit(1)
}

/** Flatten a nested message object into dotted key paths. */
function flatten(object, prefix = '') {
  const keys = []
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flatten(value, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

const load = (locale) =>
  JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8'))

const sourceKeys = new Set(flatten(load(SOURCE_LOCALE)))

const locales = readdirSync(MESSAGES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .filter((locale) => locale !== SOURCE_LOCALE)

let failed = false

for (const locale of locales) {
  const localeKeys = new Set(flatten(load(locale)))

  const missing = [...sourceKeys].filter((key) => !localeKeys.has(key))
  const extra = [...localeKeys].filter((key) => !sourceKeys.has(key))

  if (missing.length > 0) {
    failed = true
    console.error(`\n${locale}.json is missing ${missing.length} key(s):`)
    for (const key of missing.slice(0, 25)) console.error(`  - ${key}`)
    if (missing.length > 25) console.error(`  ...and ${missing.length - 25} more`)
  }

  if (extra.length > 0) {
    console.warn(`\n${locale}.json has ${extra.length} key(s) not in ${SOURCE_LOCALE}.json:`)
    for (const key of extra.slice(0, 10)) console.warn(`  + ${key}`)
  }

  if (missing.length === 0 && extra.length === 0) {
    console.log(`${locale}.json is complete (${localeKeys.size} keys)`)
  }
}

if (locales.length === 0) {
  console.log(`Only ${SOURCE_LOCALE}.json exists; nothing to compare yet.`)
}

console.log(`\n${SOURCE_LOCALE}.json defines ${sourceKeys.size} keys.`)
process.exit(failed ? 1 : 0)
