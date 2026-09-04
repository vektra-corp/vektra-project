/**
 * PDF templates (§6.4).
 *
 * `pdf_templates.template_data` is free-form jsonb, which means the renderer
 * would otherwise be trusting a blob written by a customer to describe how to
 * draw a document. Everything here parses that blob into a fully-specified,
 * bounded template: unknown keys are dropped, colours must match a strict
 * pattern, and every number is clamped to a range the page can actually hold.
 *
 * The deliberate limit: this describes STYLE and WHICH FIELDS APPEAR, not
 * absolute positions. A free-positioning editor is a far larger surface — and a
 * template that can place an element at x=9999 is a template that silently
 * produces a blank invoice.
 */

export const PDF_PAGE_SIZES = ['A4', 'LETTER'] as const
export type PdfPageSize = (typeof PDF_PAGE_SIZES)[number]

/** The three families @react-pdf/renderer ships without loading a font file. */
export const PDF_FONTS = ['Helvetica', 'Times-Roman', 'Courier'] as const
export type PdfFont = (typeof PDF_FONTS)[number]

export const PDF_COLUMNS = ['quantity', 'unitPrice', 'taxRate', 'lineTotal'] as const
export type PdfColumn = (typeof PDF_COLUMNS)[number]

export const PDF_COLUMN_LABELS: Record<PdfColumn, string> = {
  quantity: 'Quantity',
  unitPrice: 'Unit price',
  taxRate: 'Tax rate',
  lineTotal: 'Line total',
}

export interface PdfTemplate {
  /** Header rule, totals rule, and the accent bar if enabled. */
  accentColor: string
  textColor: string
  mutedColor: string
  fontFamily: PdfFont
  /** Base body size in points; everything else is derived from it. */
  fontSize: number
  pageSize: PdfPageSize
  margin: number
  /** A coloured band across the top of page one. */
  accentBar: boolean
  showLogo: boolean
  /** Overrides the document-type heading, e.g. "TAX INVOICE". Empty = default. */
  headerTitle: string
  footerText: string
  columns: PdfColumn[]
  showNotes: boolean
  showTerms: boolean
  showPaymentSummary: boolean
}

export const DEFAULT_PDF_TEMPLATE: PdfTemplate = {
  accentColor: '#18181b',
  textColor: '#18181b',
  mutedColor: '#52525b',
  fontFamily: 'Helvetica',
  fontSize: 9,
  pageSize: 'A4',
  margin: 44,
  accentBar: false,
  showLogo: false,
  headerTitle: '',
  footerText: '',
  columns: ['quantity', 'unitPrice', 'taxRate', 'lineTotal'],
  showNotes: true,
  showTerms: true,
  showPaymentSummary: true,
}

/**
 * A six-digit hex colour, or the fallback.
 *
 * Strict on purpose. The value reaches a stylesheet, and `#fff` or a named
 * colour behaves inconsistently in the renderer while an arbitrary string
 * throws mid-render — after the response has already started streaming.
 */
export function parseColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  // Control characters render as tofu or break the layout; strip rather than
  // reject, so a paste from a word processor does not fail the whole template.
  // Matching them is the entire purpose here, hence the disable.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength)
}

export function parsePdfTemplate(value: unknown): PdfTemplate {
  const raw = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_PDF_TEMPLATE

  const columns = Array.isArray(raw.columns)
    ? PDF_COLUMNS.filter((column) => (raw.columns as unknown[]).includes(column))
    : d.columns

  return {
    accentColor: parseColor(raw.accentColor, d.accentColor),
    textColor: parseColor(raw.textColor, d.textColor),
    mutedColor: parseColor(raw.mutedColor, d.mutedColor),
    fontFamily: (PDF_FONTS as readonly string[]).includes(raw.fontFamily as string)
      ? (raw.fontFamily as PdfFont)
      : d.fontFamily,
    // Below 6pt is unreadable; above 14pt a line item stops fitting on a row.
    fontSize: clampNumber(raw.fontSize, 6, 14, d.fontSize),
    pageSize: (PDF_PAGE_SIZES as readonly string[]).includes(raw.pageSize as string)
      ? (raw.pageSize as PdfPageSize)
      : d.pageSize,
    // A margin over ~110pt leaves too little width for the line-item table.
    margin: clampNumber(raw.margin, 16, 110, d.margin),
    accentBar: raw.accentBar === true,
    showLogo: raw.showLogo === true,
    headerTitle: cleanText(raw.headerTitle, 40),
    footerText: cleanText(raw.footerText, 200),
    // An empty column list would render a table of descriptions alone, which is
    // never what someone meant; fall back rather than produce that.
    columns: columns.length > 0 ? columns : d.columns,
    showNotes: raw.showNotes !== false,
    showTerms: raw.showTerms !== false,
    showPaymentSummary: raw.showPaymentSummary !== false,
  }
}

/** Widths for the line-item table, summing to 100% across the chosen columns. */
export function columnWidths(columns: PdfColumn[]): Record<string, string> {
  const weights: Record<PdfColumn, number> = {
    quantity: 12,
    unitPrice: 16,
    taxRate: 10,
    lineTotal: 16,
  }

  const used = columns.reduce((total, column) => total + weights[column], 0)
  const widths: Record<string, string> = { description: `${100 - used}%` }
  for (const column of columns) widths[column] = `${weights[column]}%`
  return widths
}
