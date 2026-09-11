import 'server-only'

import { computeTax, subscriptionNetMinor } from '@pm/shared/billing'
import { gstStateName } from '@pm/shared/constants'
import { formatCurrency } from '@pm/shared/utils'
import { sellerProfile } from '@/lib/payments/select'
import type { InvoiceTaxLine } from '@/lib/pdf/billing-invoice'
import { renderInvoicePdf } from '@/lib/pdf/render-invoice'
import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from './client'

/**
 * Invoice issue.
 *
 * Driven off captured payments rather than off the webhook directly, so a
 * webhook that succeeds and an invoice that fails are independent: the money is
 * already recorded, and issuing the document can be retried without risking the
 * ledger. `billing_invoices_one_per_payment` is the idempotency key — a second
 * run for the same payment is a unique violation, not a duplicate invoice.
 *
 * SCOPE: domestic Indian supplies only, for now. An export invoice must also
 * state its INR equivalent at a reference rate (the CHECK on billing_invoices
 * enforces that), and there is no FX source wired up. Inventing a rate on a
 * statutory document would be worse than not issuing one, so exports are left
 * for an operator and reported in the job's return value.
 */

const SERIES = 'VC'

export const issueInvoices = inngest.createFunction(
  { id: 'billing-issue-invoices', retries: 3 },
  { cron: '*/10 * * * *' },
  async ({ step }) => {
    const candidates = await step.run('load-captured', async () => {
      const db = createAdminClient()
      const { data, error } = await db
        .from('payments')
        .select(
          'id, organization_id, subscription_id, plan_id, currency, amount_minor, seats, captured_at, billing_period_start, billing_period_end, amount_mismatch',
        )
        .eq('status', 'captured')
        .eq('amount_mismatch', false)
        .order('captured_at', { ascending: true })
        .limit(25)
      if (error) throw new Error(error.message)
      return data ?? []
    })

    let issued = 0
    let skippedExport = 0
    let skipped = 0

    for (const payment of candidates) {
      const outcome = await step.run(`invoice-${payment.id}`, async () => {
        const db = createAdminClient()

        // Already issued. Cheaper than relying on the unique violation, and it
        // keeps the job's counters honest.
        const { count: existing } = await db
          .from('billing_invoices')
          .select('id', { count: 'exact', head: true })
          .eq('payment_id', payment.id)
          .eq('status', 'issued')
        if ((existing ?? 0) > 0) return 'skipped' as const

        const { data: org } = await db
          .from('organizations')
          .select('name, billing_email, billing_country, billing_state, gstin, address')
          .eq('id', payment.organization_id)
          .single()
        if (!org?.billing_country) return 'skipped' as const

        // Exports need a reference FX rate we do not have. Left for an operator.
        if (org.billing_country !== 'IN') return 'export' as const

        const { data: subscription } = await db
          .from('subscriptions')
          // Hinted: subscriptions has two FKs to plans (plan_id and
          // pending_plan_id), so an unqualified embed is ambiguous.
          .select('id, unit_amount_minor, seats, plan:plans!subscriptions_plan_id_fkey(display_name)')
          .eq('id', payment.subscription_id ?? '')
          .maybeSingle()

        const seats = payment.seats ?? subscription?.seats ?? 1
        const unit = subscription?.unit_amount_minor ?? 0
        if (unit <= 0) return 'skipped' as const

        const seller = sellerProfile()

        // Recomputed from the priced figures rather than decomposed out of the
        // captured total: dividing a gross amount back down re-introduces the
        // rounding the pricing path already resolved, and the invoice's taxable
        // line has to match what was actually quoted.
        const netMinor = subscriptionNetMinor(unit, seats)
        const tax = computeTax({
          netMinor,
          buyerCountry: org.billing_country,
          buyerGstin: org.gstin,
          buyerState: org.billing_state,
          sellerState: seller.state,
          lutArn: seller.lutArn,
        })

        // If the gateway charged something other than what this invoice would
        // say, do not paper over it with a document. payments.amount_mismatch
        // covers the recorded case; this covers a drift introduced since.
        if (tax.totalMinor !== payment.amount_minor) return 'skipped' as const

        const issueDate = (payment.captured_at ?? new Date().toISOString()).slice(0, 10)

        const { data: numbering, error: numberError } = await db.rpc(
          'next_billing_invoice_number',
          { p_series: SERIES, p_date: issueDate },
        )
        if (numberError) throw new Error(numberError.message)
        const numbers = Array.isArray(numbering) ? numbering[0] : numbering
        if (!numbers) throw new Error('could not claim an invoice number')

        const planName = subscription?.plan?.display_name ?? 'Subscription'
        const period =
          payment.billing_period_start && payment.billing_period_end
            ? `${payment.billing_period_start.slice(0, 10)} to ${payment.billing_period_end.slice(0, 10)}`
            : null

        const { data: invoice, error: insertError } = await db
          .from('billing_invoices')
          .insert({
            organization_id: payment.organization_id,
            subscription_id: payment.subscription_id,
            payment_id: payment.id,
            invoice_number: numbers.invoice_number,
            series: SERIES,
            fiscal_year: numbers.fiscal_year,
            sequence_number: numbers.sequence_number,
            issue_date: issueDate,
            tax_treatment: tax.treatment,
            seller_snapshot: {
              name: seller.legalName,
              parent_entity: seller.parentEntity,
              address: seller.address,
            } as never,
            seller_gstin: seller.gstin,
            seller_state: seller.state,
            lut_arn: tax.treatment === 'export_lut' ? seller.lutArn : null,
            buyer_snapshot: {
              name: org.name,
              email: org.billing_email,
              address: org.address,
            } as never,
            buyer_gstin: org.gstin,
            buyer_country: org.billing_country,
            place_of_supply: tax.placeOfSupply,
            sac_code: seller.sacCode,
            currency: payment.currency,
            taxable_minor: tax.taxableMinor,
            cgst_rate_bp: tax.cgstRateBp,
            sgst_rate_bp: tax.sgstRateBp,
            igst_rate_bp: tax.igstRateBp,
            cgst_minor: tax.cgstMinor,
            sgst_minor: tax.sgstMinor,
            igst_minor: tax.igstMinor,
            total_minor: tax.totalMinor,
            quantity: seats,
            line_description: `${planName} — ${seats} ${seats === 1 ? 'seat' : 'seats'}`,
            period_start: payment.billing_period_start?.slice(0, 10) ?? null,
            period_end: payment.billing_period_end?.slice(0, 10) ?? null,
          })
          .select('id, invoice_number')
          .single()

        // Another run got there first. The number we claimed is burned, which is
        // acceptable: the sequence must be gapless per issued invoice, not per
        // attempt, and a duplicate document would be far worse.
        if (insertError?.code === '23505') return 'skipped' as const
        if (insertError || !invoice) throw new Error(insertError?.message ?? 'insert failed')

        // --- Render and store ---------------------------------------------
        const money = (minor: number) => formatCurrency(minor / 100, payment.currency, 'en-IN')

        const taxLines: InvoiceTaxLine[] = []
        if (tax.cgstMinor > 0) {
          taxLines.push({
            label: 'CGST',
            rate: `${(tax.cgstRateBp / 100).toFixed(2)}%`,
            amount: money(tax.cgstMinor),
          })
        }
        if (tax.sgstMinor > 0) {
          taxLines.push({
            label: 'SGST',
            rate: `${(tax.sgstRateBp / 100).toFixed(2)}%`,
            amount: money(tax.sgstMinor),
          })
        }
        if (tax.igstMinor > 0) {
          taxLines.push({
            label: 'IGST',
            rate: `${(tax.igstRateBp / 100).toFixed(2)}%`,
            amount: money(tax.igstMinor),
          })
        }

        const buffer = await renderInvoicePdf({
          invoiceNumber: invoice.invoice_number,
          issueDate,
          placeOfSupply: `${gstStateName(tax.placeOfSupply) ?? tax.placeOfSupply} (${tax.placeOfSupply})`,
          sacCode: seller.sacCode,
          reverseCharge: false,
          taxTreatment: tax.treatment,
          seller: {
            name: seller.legalName,
            parentEntity: seller.parentEntity,
            address: seller.address,
            gstin: seller.gstin,
            stateName: gstStateName(seller.state),
          },
          buyer: {
            name: org.name,
            gstin: org.gstin,
            country: org.billing_country,
            email: org.billing_email,
          },
          lineDescription: `${planName} — ${seats} ${seats === 1 ? 'seat' : 'seats'}`,
          quantity: seats,
          period,
          taxable: money(tax.taxableMinor),
          taxLines,
          total: money(tax.totalMinor),
          lutArn: seller.lutArn,
        })

        // org_id prefix (§13.9): a leaked signed URL cannot be edited into
        // another tenant's invoice.
        const path = `${payment.organization_id}/${invoice.id}.pdf`
        const { error: uploadError } = await db.storage
          .from('invoices')
          .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
        if (uploadError) throw new Error(uploadError.message)

        await db
          .from('billing_invoices')
          .update({ pdf_storage_path: path, pdf_generated_at: new Date().toISOString() })
          .eq('id', invoice.id)

        return 'issued' as const
      })

      if (outcome === 'issued') issued += 1
      else if (outcome === 'export') skippedExport += 1
      else skipped += 1
    }

    return { considered: candidates.length, issued, skipped, awaitingFxRate: skippedExport }
  },
)
