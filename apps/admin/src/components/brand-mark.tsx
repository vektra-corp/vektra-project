import { cn } from '@pm/ui'
import Image from 'next/image'

/**
 * The Vektra Corp mark — the CORPORATE logo, used only here.
 *
 * The customer app carries the product's P. Keeping the two apart is not
 * decoration: an operator holding a service-role session that reaches every
 * tenant must never mistake this console for the tenant app they were just
 * looking at. The different letterform is the first signal, the "service role ·
 * all tenants" caption beneath it is the second.
 */
export function AdminBrandMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/vektra-corp-mark.png"
      alt=""
      width={26}
      height={26}
      className={cn('h-[26px] w-[26px] shrink-0 object-contain', className)}
      priority
      aria-hidden
    />
  )
}
