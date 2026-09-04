import { redirect } from 'next/navigation'

/** Commercial has no landing page of its own; invoices are the common entry. */
export default function CommercialIndexPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string }
}) {
  redirect(`/${params.orgSlug}/${params.workspaceSlug}/commercial/invoices`)
}
