import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

/**
 * Commercial document PDF (§3, §19.2).
 *
 * Deliberately plain and self-contained: no external fonts, no images, no
 * network. A PDF is generated on a server request, so anything it fetches is a
 * request the caller can make it perform.
 *
 * Money arrives pre-formatted from the caller. Formatting depends on locale and
 * currency, and `Intl` behaviour inside the renderer is not somewhere to
 * discover a discrepancy — the numbers here must match what the app shows.
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

const styles = StyleSheet.create({
  page: { padding: 44, fontSize: 9, color: '#18181b', fontFamily: 'Helvetica' },

  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  docNumber: { fontSize: 10, color: '#52525b', marginTop: 4 },
  status: { fontSize: 8, color: '#71717a', marginTop: 2, textTransform: 'uppercase' },

  orgName: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#52525b', marginTop: 2 },

  parties: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  party: { width: '48%' },
  partyLabel: {
    fontSize: 7,
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },

  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#18181b',
    paddingBottom: 5,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e4e4e7',
    paddingVertical: 6,
  },
  colDescription: { width: '46%' },
  colQty: { width: '12%', textAlign: 'right' },
  colPrice: { width: '16%', textAlign: 'right' },
  colTax: { width: '10%', textAlign: 'right' },
  colTotal: { width: '16%', textAlign: 'right' },
  headText: { fontSize: 7, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.6 },

  totals: { marginTop: 14, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', width: 220, justifyContent: 'space-between', paddingVertical: 3 },
  grandRow: {
    flexDirection: 'row',
    width: 220,
    justifyContent: 'space-between',
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#18181b',
  },
  grandText: { fontFamily: 'Helvetica-Bold', fontSize: 11 },

  block: { marginTop: 22 },
  blockLabel: {
    fontSize: 7,
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },

  footer: {
    position: 'absolute',
    bottom: 28,
    left: 44,
    right: 44,
    fontSize: 7,
    color: '#a1a1aa',
    textAlign: 'center',
  },
})

export function CommercialDocumentPdf({ data }: { data: PdfDocumentData }) {
  return (
    <Document
      title={`${data.docTypeLabel} ${data.docNumber}`}
      author={data.organization.name}
      creator={data.organization.name}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{data.docTypeLabel}</Text>
            <Text style={styles.docNumber}>{data.docNumber}</Text>
            <Text style={styles.status}>{data.status.replace('_', ' ')}</Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
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
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                  {data.contact.company ?? data.contact.name}
                </Text>
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
          <Text style={[styles.colDescription, styles.headText]}>Description</Text>
          <Text style={[styles.colQty, styles.headText]}>Qty</Text>
          <Text style={[styles.colPrice, styles.headText]}>Unit price</Text>
          <Text style={[styles.colTax, styles.headText]}>Tax</Text>
          <Text style={[styles.colTotal, styles.headText]}>Amount</Text>
        </View>

        {data.lineItems.length === 0 ? (
          <View style={styles.row}>
            <Text style={{ color: '#a1a1aa' }}>No line items</Text>
          </View>
        ) : (
          data.lineItems.map((item, index) => (
            // Line items have no stable id in this projection and never reorder
            // within a render.
            // eslint-disable-next-line react/no-array-index-key
            <View key={index} style={styles.row} wrap={false}>
              <Text style={styles.colDescription}>{item.description}</Text>
              <Text style={styles.colQty}>{item.quantity}</Text>
              <Text style={styles.colPrice}>{item.unitPrice}</Text>
              <Text style={styles.colTax}>{item.taxRate}</Text>
              <Text style={styles.colTotal}>{item.lineTotal}</Text>
            </View>
          ))
        )}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={{ color: '#52525b' }}>Subtotal</Text>
            <Text>{data.subtotal}</Text>
          </View>

          {data.discountTotal ? (
            <View style={styles.totalRow}>
              <Text style={{ color: '#52525b' }}>Discount</Text>
              <Text>-{data.discountTotal}</Text>
            </View>
          ) : null}

          <View style={styles.totalRow}>
            <Text style={{ color: '#52525b' }}>Tax</Text>
            <Text>{data.taxTotal}</Text>
          </View>

          <View style={styles.grandRow}>
            <Text style={styles.grandText}>Total</Text>
            <Text style={styles.grandText}>{data.grandTotal}</Text>
          </View>

          {data.amountPaid ? (
            <>
              <View style={styles.totalRow}>
                <Text style={{ color: '#52525b' }}>Paid</Text>
                <Text>{data.amountPaid}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>Outstanding</Text>
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>{data.outstanding}</Text>
              </View>
            </>
          ) : null}
        </View>

        {data.notes ? (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Notes</Text>
            <Text style={{ color: '#52525b', lineHeight: 1.5 }}>{data.notes}</Text>
          </View>
        ) : null}

        {data.terms ? (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Terms</Text>
            <Text style={{ color: '#52525b', lineHeight: 1.5 }}>{data.terms}</Text>
          </View>
        ) : null}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${data.docNumber} · ${data.organization.name} · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  )
}
