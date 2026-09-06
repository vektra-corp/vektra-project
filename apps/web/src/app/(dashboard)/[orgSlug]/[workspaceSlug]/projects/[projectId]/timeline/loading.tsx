import { SectionSkeleton } from '@/components/layout/skeletons'

/** Gantt: the heaviest view in the app, and the one most worth a shaped fallback. */
export default function Loading() {
  return <SectionSkeleton variant="timeline" />
}
