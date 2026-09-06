import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from '@pm/shared/constants'
import { headers } from 'next/headers'
import { cache } from 'react'
import { getSigningKeys } from '@/lib/auth/jwks'
import { createClient } from '@/lib/supabase/server'

/**
 * Locale resolution order (claude.md §21.3):
 *   1. User profile setting
 *   2. Organization default
 *   3. Accept-Language header
 *   4. 'en'
 *
 * This is the first thing that happens on every request — next-intl calls it
 * from the root layout, before any page code runs — so its cost is paid by every
 * navigation whether or not anything on screen is localised. It used to be three
 * sequential round trips: getUser(), then the profile, then the org. Now it is
 * one wave.
 *
 * The identity comes from the locally verified token rather than the auth server
 * (see `lib/auth/context.ts` for why that is sound). The two settings lookups
 * run together instead of one behind the other: the org's locale is only a
 * fallback for the user's, but asking for both at once costs no more than asking
 * for one, and the common case needs the answer to be fast, not minimal.
 *
 * `cache` matters even though next-intl memoises its config: `resolveLocale` is
 * exported and called directly elsewhere, and without it those callers each pay
 * the round trip again.
 */
export const resolveLocale = cache(async (): Promise<Locale> => {
  const supabase = createClient()

  const keys = await getSigningKeys()
  const { data: claimsData } = await supabase.auth.getClaims(
    undefined,
    keys ? { jwks: { keys: keys as never } } : undefined,
  )
  const userId = claimsData?.claims?.sub

  if (userId) {
    const [{ data: profile }, { data: membership }] = await Promise.all([
      supabase.from('profiles').select('settings').eq('id', userId).maybeSingle(),
      supabase
        .from('org_members')
        .select('organizations!inner(settings)')
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const userLocale = (profile?.settings as { locale?: string } | null)?.locale
    if (isSupportedLocale(userLocale)) return userLocale

    const org = membership?.organizations as unknown as { settings?: { locale?: string } } | null
    const orgLocale = org?.settings?.locale
    if (isSupportedLocale(orgLocale)) return orgLocale
  }

  return localeFromAcceptLanguage(headers().get('accept-language'))
})

/** Best match from an Accept-Language header, ignoring region subtags. */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE

  const candidates = header
    .split(',')
    .map((part) => {
      const [tag = '', quality] = part.trim().split(';q=')
      return { tag: tag.split('-')[0]?.toLowerCase() ?? '', q: Number.parseFloat(quality ?? '1') }
    })
    .filter((candidate) => candidate.tag && Number.isFinite(candidate.q))
    .sort((a, b) => b.q - a.q)

  for (const candidate of candidates) {
    if (isSupportedLocale(candidate.tag)) return candidate.tag
  }
  return DEFAULT_LOCALE
}
