import DOMPurify from 'isomorphic-dompurify'

/**
 * HTML sanitization (claude.md §13.1).
 *
 * Split out from `sanitize.ts` because of what importing it costs. DOMPurify
 * pulls in jsdom on the server, and jsdom reads a stylesheet off disk when it
 * loads. Webpack bundles that read but not the file, so ANY server action that
 * imported the module — even one only calling the pure Tiptap helpers — died
 * with `ENOENT ... default-stylesheet.css` and returned a 500.
 *
 * Creating a task, a subtask, a comment and a document were all broken by that.
 * Nothing reported it: typecheck passed, the unit tests passed (they resolve
 * jsdom normally from node_modules), and the page rendered fine — only the
 * write failed, silently, in the browser. An end-to-end test clicking "Add"
 * found it.
 *
 * So: import this module only where HTML actually needs sanitizing. Everything
 * that works on Tiptap JSON, URLs or filenames belongs in `sanitize.ts`, which
 * is pure and has no dependencies.
 */

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'blockquote',
  'code',
  'pre',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
]

const ALLOWED_ATTR = ['href', 'src', 'alt', 'class', 'target', 'rel', 'data-mention-id']

export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['rel'],
    FORCE_BODY: true,
  })
}


/**
 * Validate a URL before it reaches an `href`. Returns null when unsafe, so the
 * caller renders plain text instead of a link (§13.2).
 */
