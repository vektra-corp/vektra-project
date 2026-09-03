import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from '@pm/shared/constants'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

/**
 * Locale resolution order (claude.md §21.3):
 *   1. User profile setting
 *   2. Organization default
 *   3. Accept-Language header
 *   4. 'en'
 */
export async function resolveLocale(): Promise<Locale> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .maybeSingle()

    const userLocale = (profile?.settings as { locale?: string } | null)?.locale
    if (isSupportedLocale(userLocale)) return userLocale

    const { data: membership } = await supabase
      .from('org_members')
      .select('organizations!inner(settings)')
      .eq('user_id', user.id)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle()

    const org = membership?.organizations as unknown as { settings?: { locale?: string } } | null
    const orgLocale = org?.settings?.locale
    if (isSupportedLocale(orgLocale)) return orgLocale
  }

  return localeFromAcceptLanguage(headers().get('accept-language'))
}

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
