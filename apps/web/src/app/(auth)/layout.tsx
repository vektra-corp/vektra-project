import type { ReactNode } from 'react'
import { BrandLogo } from '@/components/layout/brand-mark'

/**
 * Signed-out shell.
 *
 * The design signs the page from a header bar rather than stacking the mark on
 * the card: the card stays a single object, and the compliance mark sits
 * opposite the wordmark where it reads as a property of the product rather than
 * of the form. The card itself is 392px with 32/34 of padding.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen flex-col overflow-y-auto">
      <header className="flex shrink-0 items-center gap-[9px] px-[22px] py-[18px]">
        <BrandLogo size={22} className="h-[22px] w-[22px]" title="Vektra" />
        <span className="text-[14px] font-semibold tracking-[0.02em]">Vektra</span>
        <span className="text-subtle ms-auto font-mono text-meta uppercase tracking-[0.08em]">
          SOC 2 Type II
        </span>
      </header>

      <div className="flex flex-1 items-center justify-center px-10 pb-11 pt-2">
        <div className="w-[392px] max-w-full">{children}</div>
      </div>
    </div>
  )
}
