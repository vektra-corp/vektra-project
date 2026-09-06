import { PageSkeleton } from '@/components/layout/skeletons'

/** Workflow list and editor both render their own Topbar. */
export default function Loading() {
  return <PageSkeleton variant="table" />
}
