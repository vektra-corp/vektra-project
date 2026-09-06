import { PageSkeleton } from '@/components/layout/skeletons'

/** External portal. No action button: portal users have far fewer affordances. */
export default function Loading() {
  return <PageSkeleton withAction={false} />
}
