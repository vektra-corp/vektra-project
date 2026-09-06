'use client'

import { useRouter } from 'next/navigation'
import { useTransition, type MouseEvent } from 'react'

/**
 * Immediate feedback on a navigation click.
 *
 * A `loading.tsx` fallback cannot paint until the router has the route's loading
 * boundary — prefetched in production, but fetched on demand in development,
 * where prefetching is disabled. That leaves a window in which a click has
 * visibly done nothing, which is the complaint this exists to answer.
 *
 * Driving the push through a transition closes it: `pending` flips synchronously
 * on click, so the row can respond before any network activity starts.
 *
 * The element stays a real `<a>` rather than becoming a button. Modified clicks
 * (new tab, new window, download) and the browser's own affordances — middle
 * click, right-click "Open in new tab", link preview, copy address — all depend
 * on that, so those events are handed back to the browser untouched.
 */
export function usePendingNav() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onNavigate(href: string) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      // Anything but a plain left click belongs to the browser.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      event.preventDefault()
      startTransition(() => {
        router.push(href)
      })
    }
  }

  return { pending, onNavigate }
}
