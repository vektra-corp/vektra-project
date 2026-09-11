import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/context'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Download an invoice PDF.
 *
 * The storage bucket is private and has no policy for `authenticated` (00047),
 * so this route is the access-control boundary rather than the bucket. Three
 * things have to hold before a URL is minted:
 *
 *  1. A session, in this organization, with an owner or admin role (§8).
 *  2. The invoice row is readable through the USER's client — the "Org admins
 *     read their invoices" policy does the tenant scoping, so a guessed invoice
 *     id from another tenant returns nothing rather than being checked here.
 *  3. A PDF has actually been rendered.
 *
 * Only then does the service role mint a short-lived signed URL. The user's
 * client cannot do it: it has no storage policy, which is deliberate.
 */

export const runtime = 'nodejs'

/** Short enough that a shared link is useless quickly; long enough to download. */
const SIGNED_URL_TTL_SECONDS = 120

export async function GET(
  _request: Request,
  { params }: { params: { orgSlug: string; invoiceId: string } },
) {
  const auth = await requireAuth(params.orgSlug)

  if (!ORG_ADMIN_ROLES.includes(auth.orgRole)) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
  }

  // Read through the user's client so RLS decides tenancy. A row belonging to
  // another organization is simply not visible, and the response below cannot
  // distinguish that from "no such invoice" — which is the intent.
  const supabase = createClient()
  const { data: invoice } = await supabase
    .from('billing_invoices')
    .select('id, invoice_number, pdf_storage_path, organization_id')
    .eq('id', params.invoiceId)
    .maybeSingle()

  if (!invoice || invoice.organization_id !== auth.orgId) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  if (!invoice.pdf_storage_path) {
    return NextResponse.json(
      { error: 'This invoice is still being prepared', code: 'NOT_READY' },
      { status: 409 },
    )
  }

  const { data: signed, error } = await createAdminClient()
    .storage.from('invoices')
    .createSignedUrl(invoice.pdf_storage_path, SIGNED_URL_TTL_SECONDS, {
      download: `${invoice.invoice_number.replace(/\//g, '-')}.pdf`,
    })

  if (error || !signed) {
    return NextResponse.json(
      { error: 'Could not prepare the download', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }

  return NextResponse.redirect(signed.signedUrl)
}
