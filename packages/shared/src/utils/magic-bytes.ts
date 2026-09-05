/**
 * Content sniffing for uploads (§13.9).
 *
 * The browser-supplied `Content-Type` is attacker-controlled and the extension
 * is just text in a filename. Neither says what a file actually IS. This reads
 * the leading bytes, which is the only claim the file makes about itself that
 * the uploader cannot trivially forge without also changing the content.
 *
 * What this is and is not:
 *
 *   - It is a check that the declared type matches the real one, so `evil.exe`
 *     renamed to `photo.png` with `image/png` is refused.
 *   - It is NOT a malware scanner. A genuinely valid PNG can still be malicious;
 *     that is what antivirus is for, and it is tracked separately.
 *
 * Failing closed matters here. An unrecognised signature is REJECTED rather
 * than waved through, because "we could not tell what this is" is not a good
 * reason to store and later serve it.
 */

export interface Signature {
  /** Bytes that must match, as unsigned 8-bit values. `null` means any byte. */
  readonly bytes: readonly (number | null)[]
  readonly offset: number
  readonly mime: string
}

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0))

/**
 * Ordered longest-first within a family so a more specific match wins — RIFF
 * covers both WebP and WAV, and `ftyp` covers every MP4 variant.
 */
export const SIGNATURES: readonly Signature[] = [
  // --- images ---
  { offset: 0, mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { offset: 0, mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { offset: 0, mime: 'image/gif', bytes: ascii('GIF87a') },
  { offset: 0, mime: 'image/gif', bytes: ascii('GIF89a') },
  { offset: 0, mime: 'image/webp', bytes: [...ascii('RIFF'), null, null, null, null, ...ascii('WEBP')] },
  { offset: 0, mime: 'image/bmp', bytes: ascii('BM') },
  { offset: 0, mime: 'image/tiff', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { offset: 0, mime: 'image/tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { offset: 0, mime: 'image/avif', bytes: [null, null, null, null, ...ascii('ftypavif')] },
  { offset: 0, mime: 'image/heic', bytes: [null, null, null, null, ...ascii('ftypheic')] },

  // --- documents ---
  { offset: 0, mime: 'application/pdf', bytes: ascii('%PDF-') },
  // Every OOXML and ODF document is a zip. The specific Office type cannot be
  // told apart without reading the archive, so they all sniff as zip and the
  // extension decides which of them it is allowed to claim.
  { offset: 0, mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { offset: 0, mime: 'application/zip', bytes: [0x50, 0x4b, 0x05, 0x06] },
  { offset: 0, mime: 'application/zip', bytes: [0x50, 0x4b, 0x07, 0x08] },
  // Legacy Office (.doc/.xls/.ppt) is an OLE compound file.
  { offset: 0, mime: 'application/x-ole-storage', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },

  // --- audio and video ---
  { offset: 0, mime: 'video/mp4', bytes: [null, null, null, null, ...ascii('ftyp')] },
  { offset: 0, mime: 'video/webm', bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { offset: 0, mime: 'audio/mpeg', bytes: ascii('ID3') },
  { offset: 0, mime: 'audio/mpeg', bytes: [0xff, 0xfb] },
  { offset: 0, mime: 'audio/ogg', bytes: ascii('OggS') },
  { offset: 0, mime: 'audio/wav', bytes: [...ascii('RIFF'), null, null, null, null, ...ascii('WAVE')] },

  // --- executables, matched so they can be NAMED in the rejection ---
  { offset: 0, mime: 'application/x-msdownload', bytes: ascii('MZ') },
  { offset: 0, mime: 'application/x-elf', bytes: [0x7f, ...ascii('ELF')] },
  { offset: 0, mime: 'application/x-mach-binary', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { offset: 0, mime: 'application/x-mach-binary', bytes: [0xca, 0xfe, 0xba, 0xbe] },
  { offset: 0, mime: 'application/x-shellscript', bytes: ascii('#!') },
]

/** Types that are never accepted, whatever they claim or how they arrived. */
export const DANGEROUS_SNIFFED_TYPES: readonly string[] = [
  'application/x-msdownload',
  'application/x-elf',
  'application/x-mach-binary',
  'application/x-shellscript',
]

/** How many leading bytes are enough to identify everything above. */
export const SNIFF_BYTES = 32

function matches(bytes: Uint8Array, signature: Signature): boolean {
  if (bytes.length < signature.offset + signature.bytes.length) return false
  return signature.bytes.every((expected, index) => {
    if (expected === null) return true
    return bytes[signature.offset + index] === expected
  })
}

/**
 * The MIME type the bytes actually indicate, or null when unrecognised.
 *
 * Longest signature first, so `RIFF....WEBP` beats a hypothetical `RIFF`, and
 * `ftypavif` beats the generic `ftyp` of MP4.
 */
export function sniffMimeType(bytes: Uint8Array): string | null {
  const ordered = [...SIGNATURES].sort((a, b) => b.bytes.length - a.bytes.length)
  for (const signature of ordered) {
    if (matches(bytes, signature)) return signature.mime
  }
  return null
}

/**
 * Whether sniffed content may be stored under a declared type and extension.
 *
 * The rules, and why each exists:
 *
 *   1. An executable signature is refused outright. This is the case the whole
 *      check exists for.
 *   2. Nothing unrecognised is stored. Failing closed.
 *   3. A zip may present as any zip-based Office format, because those cannot
 *      be told apart without opening the archive.
 *   4. Otherwise the sniffed family must match the declared family. `image/png`
 *      declared for `image/jpeg` content is a harmless mismatch and allowed
 *      through as the SNIFFED type; `image/png` declared for a PDF is not.
 *
 * The returned `mime` is what should be stored: the truth, not the claim.
 */
export type SniffVerdict =
  | { ok: true; mime: string }
  | { ok: false; reason: string }

const ZIP_BACKED = [
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/epub+zip',
]

const OLE_BACKED = [
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]

/** Text formats have no signature at all; they are identified by extension. */
const TEXTUAL_EXTENSIONS = ['txt', 'csv', 'md', 'log', 'json', 'xml', 'yaml', 'yml']

export function checkSniffedType(
  bytes: Uint8Array,
  declared: string,
  extension: string,
): SniffVerdict {
  const sniffed = sniffMimeType(bytes)

  if (sniffed && DANGEROUS_SNIFFED_TYPES.includes(sniffed)) {
    return { ok: false, reason: 'That file is an executable' }
  }

  if (!sniffed) {
    // Plain text genuinely has no magic number. It is accepted only when the
    // extension says text AND the bytes contain no NUL — a binary masquerading
    // as .txt fails the second test.
    if (TEXTUAL_EXTENSIONS.includes(extension) && !bytes.includes(0)) {
      return { ok: true, mime: declared.startsWith('text/') ? declared : 'text/plain' }
    }
    return { ok: false, reason: 'That file type could not be identified' }
  }

  if (sniffed === 'application/zip' && ZIP_BACKED.includes(declared)) {
    return { ok: true, mime: declared }
  }

  if (sniffed === 'application/x-ole-storage') {
    return OLE_BACKED.includes(declared)
      ? { ok: true, mime: declared }
      : { ok: false, reason: 'That file does not match its declared type' }
  }

  const family = (value: string) => value.split('/')[0]

  // `application/*` is not a family in any useful sense — a zip and a PDF share
  // it while having nothing else in common — so anything under it must match
  // exactly. The zip and OLE cases above are the only permitted substitutions.
  if (family(sniffed) === 'application' || family(declared) === 'application') {
    return sniffed === declared
      ? { ok: true, mime: sniffed }
      : { ok: false, reason: 'That file does not match its declared type' }
  }

  if (family(sniffed) !== family(declared)) {
    return { ok: false, reason: 'That file does not match its declared type' }
  }

  // Same real family (image, audio, video), different subtype: a client
  // mislabelling a JPEG as a PNG is harmless. Store what it actually is.
  return { ok: true, mime: sniffed }
}
