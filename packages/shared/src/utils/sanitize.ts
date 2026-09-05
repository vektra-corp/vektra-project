/**
 * Sanitization helpers (claude.md §13.1).
 *
 * RULE: rich text is sanitized SERVER-SIDE BEFORE STORAGE, not only on render.
 * A payload that reaches the database is already safe, so every consumer of that
 * row — the web app, the portal, a PDF, a webhook — inherits the guarantee.
 *
 * This module is deliberately DEPENDENCY-FREE. The HTML sanitizer lives in
 * `sanitize-html.ts` because DOMPurify drags jsdom in behind it, and jsdom
 * broke every server action that imported this file. See that module for the
 * full story.
 */

/** C0/C1 control characters, excluding tab, newline and carriage return. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]', 'g')

/** Protocols permitted in user-supplied links. Blocks javascript:, data:, vbscript:. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function safeUrl(input: string | null | undefined): string | null {
  if (!input) return null
  try {
    const url = new URL(input.trim())
    return SAFE_PROTOCOLS.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Strip path traversal and special characters from an uploaded file name (§13.1).
 * The stored path is `{org_id}/attachments/{uuid}/{sanitized}` so even a crafted
 * name cannot escape the tenant prefix.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[^\w\s\-.]/g, '') // Remove special chars
    .replace(/\.{2,}/g, '.') // No double dots (path traversal)
    .replace(/^\.+/, '') // No leading dots
    .trim()
    .slice(0, 255)

  return cleaned || 'file'
}

/**
 * Tiptap stores content as JSON, not HTML. Walk the document and sanitize every
 * text node and link mark, dropping unknown node types.
 */
export interface TiptapNode {
  type?: string
  text?: string
  content?: TiptapNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  attrs?: Record<string, unknown>
}

export function sanitizeTiptapJson(node: unknown): TiptapNode | null {
  if (!node || typeof node !== 'object') return null
  const input = node as TiptapNode
  const output: TiptapNode = {}

  if (typeof input.type === 'string') output.type = input.type

  if (typeof input.text === 'string') {
    // Text nodes are rendered by React (auto-escaped); strip control characters only.
    output.text = input.text.replace(CONTROL_CHARS, '')
  }

  if (input.attrs && typeof input.attrs === 'object') {
    output.attrs = sanitizeAttrs(input.attrs)
  }

  if (Array.isArray(input.marks)) {
    output.marks = input.marks
      .filter((mark) => mark && typeof mark.type === 'string')
      .map((mark) => ({
        type: mark.type,
        ...(mark.attrs ? { attrs: sanitizeAttrs(mark.attrs) } : {}),
      }))
  }

  if (Array.isArray(input.content)) {
    output.content = input.content
      .map((child) => sanitizeTiptapJson(child))
      .filter((child): child is TiptapNode => child !== null)
  }

  return output
}

function sanitizeAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'href' || key === 'src') {
      const url = typeof value === 'string' ? safeUrl(value) : null
      if (url) result[key] = url
      continue
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    }
  }
  return result
}
