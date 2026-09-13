import { cn } from '@pm/ui'

/**
 * The Vektra Corp mark — the CORPORATE logo, used only here.
 *
 * The customer app carries the product's P. Keeping the two apart is not
 * decoration: an operator holding a service-role session that reaches every
 * tenant must never mistake this console for the tenant app they were just
 * looking at. The different letterform is the first signal, the "service role ·
 * all tenants" caption beneath it is the second.
 *
 * A plain <img> with an explicitly prefixed src, not next/image, because this
 * app is served under a basePath and next/image got it wrong in both modes:
 * optimized, the basePath reached the endpoint (/project/_next/image) but not
 * the `url` parameter inside it, so the optimizer looked for /brand/… , 404'd,
 * and returned a 400 HTML error page that the browser refused as an image;
 * unoptimized, the emitted src had no prefix at all and 404'd directly. There
 * is nothing to optimize regardless — it is a 10KB 26×26 mark, smaller than any
 * resize would produce.
 *
 * BASE_PATH must stay in step with next.config.mjs, which reads the same
 * variable with the same fallback.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH ?? '/projects'

export function AdminBrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see above: next/image cannot address this asset under a basePath.
    <img
      src={`${BASE_PATH}/brand/vektra-corp-mark.png`}
      alt=""
      width={26}
      height={26}
      className={cn('h-[26px] w-[26px] shrink-0 object-contain', className)}
      aria-hidden
    />
  )
}
