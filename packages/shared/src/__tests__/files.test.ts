import { describe, expect, it } from 'vitest'
import { PLAN_LIMITS } from '../constants/plans'
import { extensionOf, validateUpload } from '../utils/files'

const file = (name: string, type: string, size = 1024) => ({ name, size, type })

// The ceiling now arrives already resolved from the org's entitlements, so the
// tiers below are just convenient sources of a realistic number.
const STARTER = PLAN_LIMITS.starter.max_file_size_bytes
const GROWTH = PLAN_LIMITS.growth.max_file_size_bytes

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
    expect(validateUpload(file('report.pdf', 'application/pdf'), GROWTH).ok).toBe(true)
    expect(validateUpload(file('photo.png', 'image/png'), GROWTH).ok).toBe(true)
  })

  it('refuses executables by extension whatever the declared type', () => {
    for (const name of ['setup.exe', 'run.sh', 'tool.bat', 'lib.dll', 'app.jar']) {
      expect(validateUpload(file(name, 'image/png'), GROWTH).ok).toBe(false)
    }
  })

  it('refuses SVG, which is an image by every mechanical test', () => {
    // An SVG is XML that may contain <script>, and attachments are served from
    // the storage origin — opening one in a tab runs that script there. The
    // `image/` prefix rule would otherwise wave it straight through.
    // Refused by the extension rule, which runs first.
    expect(validateUpload(file('logo.svg', 'image/svg+xml'), GROWTH).ok).toBe(false)
  })

  it('refuses SVG renamed to dodge the extension check', () => {
    // Here the extension is innocent, so the MIME rule is what catches it —
    // and this is the path that names scripts as the reason.
    const verdict = validateUpload(file('logo.png', 'image/svg+xml'), GROWTH)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toMatch(/scripts/i)
  })

  it('refuses SVG declared as something innocuous', () => {
    // Extension catches what the MIME type does not.
    expect(validateUpload(file('logo.svg', 'image/png'), GROWTH).ok).toBe(false)
  })

  it('refuses HTML and XML for the same reason', () => {
    expect(validateUpload(file('page.html', 'text/html'), GROWTH).ok).toBe(false)
    expect(validateUpload(file('data.xml', 'text/xml'), GROWTH).ok).toBe(false)
  })

  it('is case-insensitive about the declared type', () => {
    expect(validateUpload(file('logo.bin', 'IMAGE/SVG+XML'), GROWTH).ok).toBe(false)
  })

  it('refuses a type outside the allow-list', () => {
    expect(validateUpload(file('thing.bin', 'application/octet-stream'), GROWTH).ok).toBe(false)
  })

  it('enforces the resolved size ceiling', () => {
    const big = file('huge.pdf', 'application/pdf', 200 * 1024 * 1024)
    const verdict = validateUpload(big, STARTER)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('FILE_TOO_LARGE')
  })

  it('gives a larger allowance on a larger ceiling', () => {
    const size = 40 * 1024 * 1024
    expect(validateUpload(file('big.pdf', 'application/pdf', size), STARTER).ok).toBe(false)
    expect(validateUpload(file('big.pdf', 'application/pdf', size), GROWTH).ok).toBe(true)
  })

  it('treats a null ceiling as unlimited', () => {
    const huge = file('huge.pdf', 'application/pdf', 5 * 1024 * 1024 * 1024)
    expect(validateUpload(huge, null).ok).toBe(true)
  })

  it('still refuses a blocked type when the ceiling is unlimited', () => {
    expect(validateUpload(file('page.html', 'text/html'), null).ok).toBe(false)
  })
})
