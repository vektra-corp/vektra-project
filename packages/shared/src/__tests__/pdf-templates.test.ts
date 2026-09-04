import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PDF_TEMPLATE,
  columnWidths,
  parseColor,
  parsePdfTemplate,
} from '../constants/pdf-templates'

describe('parseColor', () => {
  it('accepts six-digit hex and normalises case', () => {
    expect(parseColor('#AABBCC', '#000000')).toBe('#aabbcc')
    expect(parseColor('  #123456  ', '#000000')).toBe('#123456')
  })

  it('refuses everything else, because the value reaches a stylesheet', () => {
    // A bad colour throws mid-render, after the response has started.
    for (const value of ['#fff', 'red', 'rgb(0,0,0)', '#12345', '#1234567', '', null, 42, {}]) {
      expect(parseColor(value, '#000000')).toBe('#000000')
    }
  })
})

describe('parsePdfTemplate', () => {
  it('returns the default for an empty or absent blob', () => {
    expect(parsePdfTemplate(null)).toEqual(DEFAULT_PDF_TEMPLATE)
    expect(parsePdfTemplate({})).toEqual(DEFAULT_PDF_TEMPLATE)
    expect(parsePdfTemplate('nonsense')).toEqual(DEFAULT_PDF_TEMPLATE)
  })

  it('keeps values it recognises', () => {
    const t = parsePdfTemplate({
      accentColor: '#ff0000',
      fontFamily: 'Courier',
      pageSize: 'LETTER',
      fontSize: 11,
      accentBar: true,
      headerTitle: 'TAX INVOICE',
    })
    expect(t).toMatchObject({
      accentColor: '#ff0000',
      fontFamily: 'Courier',
      pageSize: 'LETTER',
      fontSize: 11,
      accentBar: true,
      headerTitle: 'TAX INVOICE',
    })
  })

  it('clamps numbers to what the page can hold', () => {
    expect(parsePdfTemplate({ fontSize: 400 }).fontSize).toBe(14)
    expect(parsePdfTemplate({ fontSize: 1 }).fontSize).toBe(6)
    expect(parsePdfTemplate({ margin: 5000 }).margin).toBe(110)
    expect(parsePdfTemplate({ margin: -20 }).margin).toBe(16)
  })

  it('falls back on an unknown font or page size rather than passing it through', () => {
    expect(parsePdfTemplate({ fontFamily: 'Comic Sans' }).fontFamily).toBe('Helvetica')
    expect(parsePdfTemplate({ pageSize: 'A0' }).pageSize).toBe('A4')
  })

  it('drops unknown columns and preserves canonical order', () => {
    expect(parsePdfTemplate({ columns: ['lineTotal', 'evil', 'quantity'] }).columns).toEqual([
      'quantity',
      'lineTotal',
    ])
  })

  it('never yields an empty column list', () => {
    // A description-only table is never what anyone configured.
    expect(parsePdfTemplate({ columns: [] }).columns).toEqual(DEFAULT_PDF_TEMPLATE.columns)
    expect(parsePdfTemplate({ columns: ['nope'] }).columns).toEqual(DEFAULT_PDF_TEMPLATE.columns)
  })

  it('treats booleans as opt-out, so an older blob keeps showing its sections', () => {
    expect(parsePdfTemplate({}).showNotes).toBe(true)
    expect(parsePdfTemplate({ showNotes: false }).showNotes).toBe(false)
    // Only an explicit true turns on something that defaults off.
    expect(parsePdfTemplate({ accentBar: 'yes' }).accentBar).toBe(false)
  })

  it('strips control characters from free text and caps its length', () => {
    // A tab and a newline pasted from a word processor become spaces rather
    // than tofu or a broken line box.
    const t = parsePdfTemplate({ headerTitle: 'A\tB\nC', footerText: 'x'.repeat(500) })
    expect(t.headerTitle).toBe('A B C')
    expect(t.footerText).toHaveLength(200)
  })

  it('ignores a non-string title instead of stringifying it', () => {
    expect(parsePdfTemplate({ headerTitle: { evil: true } }).headerTitle).toBe('')
  })
})

describe('columnWidths', () => {
  it('always sums to 100%', () => {
    for (const columns of [
      ['quantity', 'unitPrice', 'taxRate', 'lineTotal'],
      ['lineTotal'],
      ['quantity', 'lineTotal'],
    ] as const) {
      const widths = columnWidths([...columns])
      const total = Object.values(widths).reduce((sum, w) => sum + Number.parseFloat(w), 0)
      expect(total).toBeCloseTo(100)
    }
  })

  it('gives the description everything the other columns do not take', () => {
    expect(columnWidths(['lineTotal']).description).toBe('84%')
  })
})
