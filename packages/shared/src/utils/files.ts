
/**
 * File upload rules (claude.md §13.9).
 *
 * Every check here is duplicated server-side. Client-side validation exists to
 * give a fast, clear error — it is never the thing that keeps a bad file out.
 */

/** Executable types are rejected outright, whatever the declared MIME type. */
export const BLOCKED_EXTENSIONS = [
  'exe', 'sh', 'bat', 'cmd', 'ps1', 'js', 'mjs', 'cjs', 'py', 'rb', 'php',
  'jsp', 'asp', 'aspx', 'jar', 'com', 'scr', 'msi', 'dll', 'app', 'deb', 'rpm',
  'vbs', 'wsf', 'hta',
  // Scriptable markup. See BLOCKED_MIME_TYPES for why.
  'svg', 'svgz', 'html', 'htm', 'xhtml', 'shtml', 'xml', 'swf',
] as const

export const ALLOWED_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'text/',
] as const

/**
 * Types the prefix rule would otherwise admit, and must not.
 *
 * SVG is `image/*`, so it passes every check an image passes — but an SVG is
 * XML that may contain <script>, and attachments are served from Supabase
 * Storage on its own origin. Opening one in a tab executes that script there,
 * with access to whatever that origin holds. HTML and XML are the same problem
 * wearing `text/*`.
 *
 * Blocked rather than sanitized: sanitizing SVG correctly is a hard, recurring
 * problem, and nothing in this product needs to accept one.
 */
export const BLOCKED_MIME_TYPES = [
  'image/svg+xml',
  'image/svg',
  'text/html',
  'text/xml',
  'application/xhtml+xml',
  'application/xml',
] as const

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/json',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
] as const

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.')
  return index === -1 ? '' : fileName.slice(index + 1).toLowerCase()
}

export type FileRejection =
  | { ok: true }
  | { ok: false; code: 'UNSUPPORTED_FILE_TYPE' | 'FILE_TOO_LARGE'; message: string }

/**
 * Validate a file against the org's plan.
 *
 * Extension is checked as well as MIME type: the browser-supplied Content-Type
 * is attacker-controlled, so `evil.exe` renamed with `image/png` must still be
 * refused here.
 *
 * Neither check sees the CONTENT, though — both are strings the client chose.
 * The bytes are sniffed server-side in `recordAttachment`, after the upload
 * lands and before any row references it (`utils/magic-bytes`).
 */
export function validateUpload(
  file: { name: string; size: number; type: string },
  /** Ceiling from the org's resolved entitlements. `null` means unlimited. */
  maxSizeBytes: number | null,
): FileRejection {
  const extension = extensionOf(file.name)

  if ((BLOCKED_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FILE_TYPE',
      message: `.${extension} files are not allowed`,
    }
  }

  // Checked before the allow-list, because the prefix rule would let these
  // through: image/svg+xml is an image by every mechanical test.
  if ((BLOCKED_MIME_TYPES as readonly string[]).includes(file.type.toLowerCase())) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'That file type can carry scripts and is not allowed',
    }
  }

  const mimeAllowed =
    ALLOWED_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix)) ||
    (ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)

  if (!mimeAllowed) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FILE_TYPE',
      message: `${file.type || 'That file type'} is not allowed`,
    }
  }

  if (maxSizeBytes !== null && file.size > maxSizeBytes) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `Files must be under ${Math.round(maxSizeBytes / 1_048_576)} MB on this plan`,
    }
  }

  return { ok: true }
}

/**
 * Storage path for an attachment.
 *
 * The org id is the FIRST segment, which is what the storage RLS policies match
 * on (§13.9). A leaked signed URL therefore cannot be edited to walk into
 * another tenant's files, and the uuid segment stops two uploads of the same
 * filename colliding.
 */
export function attachmentPath(orgId: string, fileId: string, safeFileName: string): string {
  return `${orgId}/attachments/${fileId}/${safeFileName}`
}

/** Signed URL lifetime. Short by design — links get forwarded (§13.9). */
export const SIGNED_URL_TTL_SECONDS = 60 * 60
