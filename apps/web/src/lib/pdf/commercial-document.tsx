import {
  DEFAULT_PDF_TEMPLATE,
  PDF_COLUMN_LABELS,
  columnWidths,
  type PdfTemplate,
} from '@pm/shared/constants'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

/**
 * Commercial document PDF (§3, §19.2, §6.4).
 *
 * Self-contained by design: no external fonts and no network. A PDF is rendered
 * on a server request, so anything it fetches is a request the caller can make
 * the server perform. The one image it can draw is the organisation's own logo,
 * and that arrives already fetched and validated as a data URI — this component
 * never resolves a URL.
 *
 * Money arrives pre-formatted from the caller. Formatting depends on locale and
 * currency, and `Intl` behaviour inside the renderer is not somewhere to
 * discover a discrepancy — the numbers here must match what the app shows.
 *
 * Appearance comes from a template (`parsePdfTemplate`), which is already
 * clamped and validated before it gets here. Nothing in this file re-checks a
 * colour or a size, because nothing in this file should be reachable with an
 * unvalidated one.
 */

export interface PdfLineItem {
  description: string
  quantity: string
  unitPrice: string
  taxRate: string
  lineTotal: string
}

export interface PdfDocumentData {
  docTypeLabel: string
  docNumber: string
  status: string
  issueDate: string
  dueLabel: string
  dueDate: string | null

  organization: {
    name: string
    address: string | null
    taxId: string | null
    email: string | null
    /** Data URI, already fetched and validated. Never a remote URL. */
    logo?: string | null
  }

  contact: {
    name: string
    company: string | null
    address: string | null
    email: string | null
  } | null

  lineItems: PdfLineItem[]

  subtotal: string
  discountTotal: string | null
  taxTotal: string
  grandTotal: string
  amountPaid: string | null
  outstanding: string | null

  notes: string | null
  terms: string | null
  currency: string
}

/** The bold face paired with each base family the renderer ships. */
const BOLD_FACE: Record<string, string> = {
  Helvetica: 'Helvetica-Bold',
  'Times-Roman': 'Times-Bold',
  Courier: 'Courier-Bold',
}

/**
 * Build the stylesheet for one template.
 *
 * Sizes are derived from the template's base size rather than fixed, so raising
 * it scales the whole document instead of making the body collide with the
 * headings.
 */
function stylesFor(template: PdfTemplate) {
  const { accentColor, textColor, mutedColor, fontFamily, fontSize, margin } = template
  const bold = BOLD_FACE[fontFamily] ?? 'Helvetica-Bold'
  // Faint text is derived from the muted colour so a customer setting one
  // colour does not have to reason about a third.
  const faint = mutedColor

  return StyleSheet.create({
    page: {
      paddingTop: template.accentBar ? margin : margin,
      paddingBottom: margin,
      paddingHorizontal: margin,
      fontSize,
      color: textColor,
      fontFamily,
    },

    accentBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: accentColor },

    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: fontSize * 3 },
    title: { fontSize: fontSize * 2.2, fontFamily: bold, color: accentColor },
    docNumber: { fontSize: fontSize * 1.1, color: mutedColor, marginTop: 4 },
    status: { fontSize: fontSize * 0.9, color: faint, marginTop: 2, textTransform: 'uppercase' },

    logo: { width: 96, height: 40, objectFit: 'contain', marginBottom: 6 },
    orgName: { fontSize: fontSize * 1.2, fontFamily: bold },
    muted: { color: mutedColor, marginTop: 2 },

    parties: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: fontSize * 2.6 },
    party: { width: '48%' },
    partyLabel: {
      fontSize: fontSize * 0.78,
      color: faint,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 4,
    },
    bold: { fontFamily: bold },

    tableHead: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: accentColor,
      paddingBottom: 5,
      marginBottom: 2,
    },
    row: {
      flexDirection: 'row',
      borderBottomWidth: 0.5,
      borderBottomColor: '#e4e4e7',
      paddingVertical: 6,
    },
    right: { textAlign: 'right' },
    headText: {
      fontSize: fontSize * 0.78,
      color: mutedColor,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },

    totals: { marginTop: fontSize * 1.6, alignItems: 'flex-end' },
    totalRow: { flexDirection: 'row', width: 220, justifyContent: 'space-between', paddingVertical: 3 },
    grandRow: {
      flexDirection: 'row',
      width: 220,
      justifyContent: 'space-between',
      paddingTop: 6,
      marginTop: 4,
      borderTopWidth: 1,
      borderTopColor: accentColor,
    },
    grandText: { fontFamily: bold, fontSize: fontSize * 1.2 },

    block: { marginTop: fontSize * 2.4 },
    blockLabel: {
      fontSize: fontSize * 0.78,
      color: faint,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 4,
    },

    footer: {
      position: 'absolute',
      bottom: Math.max(16, margin - 16),
      left: margin,
      right: margin,
      fontSize: fontSize * 0.78,
      color: faint,
      textAlign: 'center',
    },
  })
}

export function CommercialDocumentPdf({
  data,
  template = DEFAULT_PDF_TEMPLATE,
}: {
  data: PdfDocumentData
  template?: PdfTemplate
}) {
  const styles = stylesFor(template)
  const widths = columnWidths(template.columns)
  const heading = template.headerTitle || data.docTypeLabel

  return (
    <Document
      title={`${data.docTypeLabel} ${data.docNumber}`}
      author={data.organization.name}
      creator={data.organization.name}
    >
      <Page size={template.pageSize} style={styles.page}>
        {template.accentBar ? <View style={styles.accentBar} fixed /> : null}

        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{heading}</Text>
            <Text style={styles.docNumber}>{data.docNumber}</Text>
            <Text style={styles.status}>{data.status.replace('_', ' ')}</Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            {template.showLogo && data.organization.logo ? (
              // Not an HTML <img>: this is @react-pdf's Image, which draws into
              // the PDF and accepts no alt prop. The rule cannot tell them apart.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.organization.logo} style={styles.logo} />
            ) : null}
            <Text style={styles.orgName}>{data.organization.name}</Text>
            {data.organization.address ? (
              <Text style={styles.muted}>{data.organization.address}</Text>
            ) : null}
            {data.organization.email ? (
              <Text style={styles.muted}>{data.organization.email}</Text>
            ) : null}
            {data.organization.taxId ? (
              <Text style={styles.muted}>Tax ID {data.organization.taxId}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>Bill to</Text>
            {data.contact ? (
              <>
                <Text style={styles.bold}>{data.contact.company ?? data.contact.name}</Text>
                {data.contact.company ? (
                  <Text style={styles.muted}>{data.contact.name}</Text>
                ) : null}
                {data.contact.address ? (
                  <Text style={styles.muted}>{data.contact.address}</Text>
                ) : null}
                {data.contact.email ? <Text style={styles.muted}>{data.contact.email}</Text> : null}
              </>
            ) : (
              <Text style={styles.muted}>No contact</Text>
            )}
          </View>

          <View style={[styles.party, { alignItems: 'flex-end' }]}>
            <Text style={styles.partyLabel}>Issued</Text>
            <Text>{data.issueDate}</Text>
            {data.dueDate ? (
              <>
                <Text style={[styles.partyLabel, { marginTop: 8 }]}>{data.dueLabel}</Text>
                <Text>{data.dueDate}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.tableHead}>
          <Text style={[{ width: widths.description }, styles.headText]}>Description</Text>
          {template.columns.map((column) => (
            <Text key={column} style={[{ width: widths[column] }, styles.right, styles.headText]}>
              {PDF_COLUMN_LABELS[column]}
            </Text>
          ))}
        </View>

        {data.lineItems.length === 0 ? (
          <View style={styles.row}>
            <Text style={{ color: template.mutedColor }}>No line items</Text>
          </View>
        ) : (
          data.lineItems.map((item, index) => (
            // Line items have no stable id in this projection and never reorder
            // within a render.
            // eslint-disable-next-line react/no-array-index-key
            <View key={index} style={styles.row} wrap={false}>
              <Text style={{ width: widths.description }}>{item.description}</Text>
              {template.columns.map((column) => (
                <Text key={column} style={[{ width: widths[column] }, styles.right]}>
                  {item[column]}
                </Text>
              ))}
            </View>
          ))
        )}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={{ color: template.mutedColor }}>Subtotal</Text>
            <Text>{data.subtotal}</Text>
          </View>

          {data.discountTotal ? (
            <View style={styles.totalRow}>
              <Text style={{ color: template.mutedColor }}>Discount</Text>
              <Text>-{data.discountTotal}</Text>
            </View>
          ) : null}

          <View style={styles.totalRow}>
            <Text style={{ color: template.mutedColor }}>Tax</Text>
            <Text>{data.taxTotal}</Text>
          </View>

          <View style={styles.grandRow}>
            <Text style={styles.grandText}>Total</Text>
            <Text style={styles.grandText}>{data.grandTotal}</Text>
          </View>

          {template.showPaymentSummary && data.amountPaid ? (
            <>
              <View style={styles.totalRow}>
                <Text style={{ color: template.mutedColor }}>Paid</Text>
                <Text>{data.amountPaid}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.bold}>Outstanding</Text>
                <Text style={styles.bold}>{data.outstanding}</Text>
              </View>
            </>
          ) : null}
        </View>

        {template.showNotes && data.notes ? (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Notes</Text>
            <Text style={{ color: template.mutedColor, lineHeight: 1.5 }}>{data.notes}</Text>
          </View>
        ) : null}

        {template.showTerms && data.terms ? (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Terms</Text>
            <Text style={{ color: template.mutedColor, lineHeight: 1.5 }}>{data.terms}</Text>
          </View>
        ) : null}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            template.footerText
              ? `${template.footerText} · Page ${pageNumber} of ${totalPages}`
              : `${data.docNumber} · ${data.organization.name} · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  )
}
