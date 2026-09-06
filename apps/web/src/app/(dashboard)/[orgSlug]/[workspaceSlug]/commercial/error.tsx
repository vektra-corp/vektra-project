'use client'

import { SectionError } from '@/components/layout/section-error'

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError {...props} title="Could not load commercial documents" />
}
