import { DEFAULT_LOCALE } from '@pm/shared/constants'
import { getRequestConfig } from 'next-intl/server'
import { resolveLocale } from '@/lib/locale'

/**
 * Locale is resolved per request from the user's profile rather than a URL
 * segment, so the same URL is shareable between colleagues who read in
 * different languages (claude.md §21.3).
 *
 * Missing keys fall back to English — a raw key must never reach the screen.
 */
export default getRequestConfig(async () => {
  let locale = DEFAULT_LOCALE

  try {
    locale = await resolveLocale()
  } catch {
    // Static rendering has no request scope; English is the correct default.
  }

  const messages = (await import(`../messages/${locale}.json`)).default
  const fallback =
    locale === DEFAULT_LOCALE
      ? messages
      : (await import(`../messages/${DEFAULT_LOCALE}.json`)).default

  return {
    locale,
    messages: { ...fallback, ...messages },
    onError() {
      // Swallow missing-message errors; the English fallback above covers them.
    },
    getMessageFallback({ key }: { key: string }) {
      return key.split('.').pop() ?? key
    },
  }
})
