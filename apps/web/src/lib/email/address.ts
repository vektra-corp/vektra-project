/**
 * Address deliverability.
 *
 * Deliberately not marked `server-only`: it holds no secrets and reads no
 * environment, and the marker would make it untestable outside a server bundle.
 */

/**
 * Reserved TLDs that can never resolve (RFC 2606 / RFC 6761).
 *
 * Seed fixtures and imported test data use these, and a provider will accept
 * such a message and then hard-bounce it asynchronously — so the app records a
 * successful send while the sending domain's reputation quietly degrades. This
 * catches them before they leave.
 */
const UNDELIVERABLE_TLDS = ['.test', '.invalid', '.example', '.localhost']

export function isUndeliverable(address: string): boolean {
  const email = address.trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at === -1) return true

  const domain = email.slice(at + 1)
  if (!domain || !domain.includes('.')) return true

  return (
    UNDELIVERABLE_TLDS.some((tld) => domain.endsWith(tld)) ||
    // example.com / .net / .org are reserved for documentation.
    /^(.*\.)?example\.(com|net|org)$/.test(domain)
  )
}
