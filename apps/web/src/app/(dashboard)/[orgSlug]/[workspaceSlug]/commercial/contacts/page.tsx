import { Badge } from '@pm/ui'
import { Contact as ContactIcon } from 'lucide-react'
import type { Metadata } from 'next'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { ContactDialog, type ContactRecord } from './contact-dialog'

export const metadata: Metadata = { title: 'Contacts' }

export default async function ContactsPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const [{ data: contacts }, { data: docs }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, type, company_name, contact_name, email, phone, tax_id, notes, address')
      .eq('organization_id', auth.orgId)
      .order('contact_name'),
    // Counted in memory rather than a subquery per row: both lists are small.
    supabase
      .from('commercial_documents')
      .select('contact_id')
      .eq('organization_id', auth.orgId)
      .not('contact_id', 'is', null),
  ])

  const docCounts = new Map<string, number>()
  for (const doc of docs ?? []) {
    if (!doc.contact_id) continue
    docCounts.set(doc.contact_id, (docCounts.get(doc.contact_id) ?? 0) + 1)
  }

  const rows: ContactRecord[] = (contacts ?? []).map((contact) => ({
    id: contact.id,
    type: contact.type,
    companyName: contact.company_name,
    contactName: contact.contact_name,
    email: contact.email,
    phone: contact.phone,
    taxId: contact.tax_id,
    notes: contact.notes,
    address: contact.address as ContactRecord['address'],
  }))

  return (
    <>
      <div className="flex items-center gap-3 px-5 pb-3">
        <p className="text-[13px] text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'contact' : 'contacts'}
        </p>
        <div className="ms-auto">
          <ContactDialog scope={params} />
        </div>
      </div>

      <PageBody>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
            <ContactIcon className="h-6 w-6 text-faint" aria-hidden />
            <p className="pt-3 text-[13px] text-muted-foreground">No contacts yet.</p>
            <p className="pt-1 text-xs text-faint">
              Add a client or vendor before raising a document.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {rows.map((contact) => (
              <li key={contact.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {contact.contactName}
                    {contact.companyName ? (
                      <span className="ps-2 text-muted-foreground">{contact.companyName}</span>
                    ) : null}
                  </p>
                  <p className="label-meta pt-1 text-faint">
                    {[contact.email, contact.phone].filter(Boolean).join(' · ') || 'No contact details'}
                  </p>
                </div>

                {docCounts.get(contact.id) ? (
                  <span className="label-meta text-faint">
                    {docCounts.get(contact.id)} docs
                  </span>
                ) : null}

                <Badge variant="secondary" shape="meta">
                  {contact.type}
                </Badge>

                <ContactDialog scope={params} contact={contact} />
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  )
}
