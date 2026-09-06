import { redirect } from 'next/navigation'

/** Commercial has no landing page of its own; quotations are the only section. */
export default function CommercialIndexPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string }
}) {
  redirect(`/${params.orgSlug}/${params.workspaceSlug}/commercial/quotations`)
}
