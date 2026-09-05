import { describe, expect, it } from 'vitest'
import { extensionOf, validateUpload } from '../utils/files'

const file = (name: string, type: string, size = 1024) => ({ name, size, type })

describe('extensionOf', () => {
  it('reads the last extension, lowercased', () => {
    expect(extensionOf('photo.PNG')).toBe('png')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })

  it('returns empty for a name with no extension', () => {
    expect(extensionOf('README')).toBe('')
  })
})

describe('validateUpload', () => {
  it('accepts an ordinary document', () => {
    expect(validateUpload(file('report.pdf', 'application/pdf'), 'growth').ok).toBe(true)
    expect(validateUpload(file('photo.png', 'image/png'), 'growth').ok).toBe(true)
  })

  it('refuses executables by extension whatever the declared type', () => {
    for (const name of ['setup.exe', 'run.sh', 'tool.bat', 'lib.dll', 'app.jar']) {
      expect(validateUpload(file(name, 'image/png'), 'growth').ok).toBe(false)
    }
  })

  it('refuses SVG, which is an image by every mechanical test', () => {
    // An SVG is XML that may contain <script>, and attachments are served from
    // the storage origin — opening one in a tab runs that script there. The
    // `image/` prefix rule would otherwise wave it straight through.
    // Refused by the extension rule, which runs first.
    expect(validateUpload(file('logo.svg', 'image/svg+xml'), 'growth').ok).toBe(false)
  })

  it('refuses SVG renamed to dodge the extension check', () => {
    // Here the extension is innocent, so the MIME rule is what catches it —
    // and this is the path that names scripts as the reason.
    const verdict = validateUpload(file('logo.png', 'image/svg+xml'), 'growth')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toMatch(/scripts/i)
  })

  it('refuses SVG declared as something innocuous', () => {
    // Extension catches what the MIME type does not.
    expect(validateUpload(file('logo.svg', 'image/png'), 'growth').ok).toBe(false)
  })

  it('refuses HTML and XML for the same reason', () => {
    expect(validateUpload(file('page.html', 'text/html'), 'growth').ok).toBe(false)
    expect(validateUpload(file('data.xml', 'text/xml'), 'growth').ok).toBe(false)
  })

  it('is case-insensitive about the declared type', () => {
    expect(validateUpload(file('logo.bin', 'IMAGE/SVG+XML'), 'growth').ok).toBe(false)
  })

  it('refuses a type outside the allow-list', () => {
    expect(validateUpload(file('thing.bin', 'application/octet-stream'), 'growth').ok).toBe(false)
  })

  it('enforces the plan size limit', () => {
    const big = file('huge.pdf', 'application/pdf', 200 * 1024 * 1024)
    const verdict = validateUpload(big, 'starter')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('FILE_TOO_LARGE')
  })

  it('gives a larger allowance on a larger plan', () => {
    const size = 40 * 1024 * 1024
    expect(validateUpload(file('big.pdf', 'application/pdf', size), 'starter').ok).toBe(false)
    expect(validateUpload(file('big.pdf', 'application/pdf', size), 'growth').ok).toBe(true)
  })
})
