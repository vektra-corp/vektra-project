import { SectionSkeleton } from '@/components/layout/skeletons'

/** Kanban: columns of cards, so the generic row list would be the wrong shape. */
export default function Loading() {
  return <SectionSkeleton variant="board" />
}
