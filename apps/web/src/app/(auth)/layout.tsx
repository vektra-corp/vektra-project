import type { ReactNode } from 'react'
import { BrandLockup } from '@/components/layout/brand-mark'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen flex-col px-4 py-6">
      {/*
       * The mark signs the page from the top-left rather than sitting on top of
       * the card, so the card stays a single object and the brand reads as the
       * page's own, matching the design's signed-out screens.
       */}
      <BrandLockup />
      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  )
}
