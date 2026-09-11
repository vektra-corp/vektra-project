import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

/**
 * A Vektra Corporation tax invoice.
 *
 * Statutory rather than decorative: under Rule 46 of the CGST Rules an invoice
 * must carry the supplier's and recipient's names, addresses and GSTINs, the
 * invoice number and date, the HSN/SAC code, the taxable value, and the tax
 * broken out by head. Every one of those has a home below, and none of them is
 * optional styling.
 *
 * All figures arrive pre-formatted from the caller (§ same rule as the
 * commercial template): formatting depends on locale and currency, and a PDF is
 * not where a discrepancy with the on-screen number should first appear.
 *
 * No fonts, no images, no network. A PDF rendered on a server request must not
 * be able to make the server fetch anything.
 */

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: '#111827', fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#6B7280' },
  label: { color: '#6B7280', fontSize: 8, textTransform: 'uppercase', marginBottom: 2 },
  parties: { flexDirection: 'row', gap: 24, marginBottom: 20 },
  party: { flex: 1 },
  partyName: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  table: { marginTop: 8, borderTopWidth: 1, borderColor: '#E5E7EB' },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 6,
  },
  headRow: { flexDirection: 'row', paddingVertical: 6, backgroundColor: '#F9FAFB' },
  cDesc: { flex: 4, paddingHorizontal: 4 },
  cQty: { flex: 1, paddingHorizontal: 4, textAlign: 'right' },
  cAmt: { flex: 2, paddingHorizontal: 4, textAlign: 'right' },
  totals: { marginTop: 12, marginLeft: 'auto', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderColor: '#111827',
    fontFamily: 'Helvetica-Bold',
  },
  footer: { marginTop: 28, fontSize: 8, color: '#6B7280', lineHeight: 1.5 },
})

export interface InvoiceTaxLine {
  label: string
  /** Pre-formatted, e.g. "9.00%". */
  rate: string
  /** Pre-formatted money. */
  amount: string
}

export interface BillingInvoiceData {
  invoiceNumber: string
  issueDate: string
  placeOfSupply: string
  sacCode: string
  reverseCharge: boolean
  /** 'intra_state' | 'inter_state' | 'export_lut' | 'export_with_igst' */
  taxTreatment: string

  seller: {
    name: string
    parentEntity?: string | null
    address?: string | null
    gstin?: string | null
    stateName?: string | null
  }
  buyer: {
    name: string
    address?: string | null
    gstin?: string | null
    country: string
    email?: string | null
  }

  lineDescription: string
  quantity: number
  period?: string | null

  /** Pre-formatted money strings. */
  taxable: string
  taxLines: InvoiceTaxLine[]
  total: string
  /** For an export invoice, the INR equivalent statement. */
  inrEquivalent?: string | null
  lutArn?: string | null
}

/** Human wording for the statutory treatment, shown so the buyer can see why. */
function treatmentNote(treatment: string, lutArn?: string | null): string {
  switch (treatment) {
    case 'intra_state':
      return 'Intra-state supply. CGST and SGST apply.'
    case 'inter_state':
      return 'Inter-state supply. IGST applies.'
    case 'export_lut':
      return `Export of services. Zero-rated supply under LUT${lutArn ? ` (ARN ${lutArn})` : ''}. No GST charged.`
    case 'export_with_igst':
      return 'Export of services. IGST charged and refund claimed; no LUT on file.'
    default:
      return ''
  }
}

export function BillingInvoicePdf({ data }: { data: BillingInvoiceData }) {
  return (
    <Document title={`Invoice ${data.invoiceNumber}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Tax Invoice</Text>
            <Text style={styles.muted}>{data.invoiceNumber}</Text>
          </View>
          <View style={{ width: 200 }}>
            <View style={styles.metaRow}>
              <Text style={styles.muted}>Issue date</Text>
              <Text>{data.issueDate}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.muted}>Place of supply</Text>
              <Text>{data.placeOfSupply}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.muted}>Reverse charge</Text>
              <Text>{data.reverseCharge ? 'Yes' : 'No'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.label}>Supplier</Text>
            <Text style={styles.partyName}>{data.seller.name}</Text>
            {data.seller.parentEntity ? (
              <Text style={styles.muted}>{data.seller.parentEntity}</Text>
            ) : null}
            {data.seller.address ? <Text>{data.seller.address}</Text> : null}
            {data.seller.gstin ? <Text>GSTIN: {data.seller.gstin}</Text> : null}
            {data.seller.stateName ? <Text>State: {data.seller.stateName}</Text> : null}
          </View>

          <View style={styles.party}>
            <Text style={styles.label}>Recipient</Text>
            <Text style={styles.partyName}>{data.buyer.name}</Text>
            {data.buyer.address ? <Text>{data.buyer.address}</Text> : null}
            {data.buyer.email ? <Text style={styles.muted}>{data.buyer.email}</Text> : null}
            <Text>
              {data.buyer.gstin ? `GSTIN: ${data.buyer.gstin}` : 'Unregistered'} ·{' '}
              {data.buyer.country}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.headRow}>
            <Text style={styles.cDesc}>Description</Text>
            <Text style={styles.cQty}>Qty</Text>
            <Text style={styles.cAmt}>Taxable value</Text>
          </View>
          <View style={styles.row}>
            <View style={styles.cDesc}>
              <Text>{data.lineDescription}</Text>
              {data.period ? <Text style={styles.muted}>{data.period}</Text> : null}
              <Text style={styles.muted}>SAC {data.sacCode}</Text>
            </View>
            <Text style={styles.cQty}>{data.quantity}</Text>
            <Text style={styles.cAmt}>{data.taxable}</Text>
          </View>
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.muted}>Taxable value</Text>
            <Text>{data.taxable}</Text>
          </View>
          {data.taxLines.map((line) => (
            <View key={line.label} style={styles.totalRow}>
              <Text style={styles.muted}>
                {line.label} ({line.rate})
              </Text>
              <Text>{line.amount}</Text>
            </View>
          ))}
          <View style={styles.grand}>
            <Text>Total</Text>
            <Text>{data.total}</Text>
          </View>
          {data.inrEquivalent ? (
            <View style={styles.totalRow}>
              <Text style={styles.muted}>INR equivalent</Text>
              <Text>{data.inrEquivalent}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.footer}>
          <Text>{treatmentNote(data.taxTreatment, data.lutArn)}</Text>
          <Text>
            This is a computer-generated invoice. Amounts are in the currency shown and were
            collected by the payment gateway on the issue date.
          </Text>
        </View>
      </Page>
    </Document>
  )
}
