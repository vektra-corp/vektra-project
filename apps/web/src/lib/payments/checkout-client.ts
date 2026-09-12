/**
 * Opening Razorpay Checkout in the browser.
 *
 * Client-side and deliberately credential-free: the only key it touches is the
 * publishable key id, which the server action hands back alongside the
 * subscription. Nothing here decides an amount — the caller has already been
 * given one by the server, and this file cannot change it.
 *
 * Shared by the billing page and the sidebar upgrade dialog so there is one
 * implementation of the script load, the handler semantics and the dismiss
 * path. Two copies of this would drift, and the half that drifts is the half
 * that decides whether a customer thinks they paid.
 */

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

interface RazorpayInstance {
  open: () => void
  on: (event: string, handler: (payload: unknown) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

/** Load Checkout once; resolve immediately if it is already present. */
export function loadCheckoutScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('No window'))
    if (window.Razorpay) return resolve()

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Checkout failed to load')))
      return
    }

    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT
    script.async = true
    script.onload = () => resolve()
    // Almost always a blocked request rather than a network failure: a CSP
    // without checkout.razorpay.com in script-src fails exactly here, silently.
    script.onerror = () => reject(new Error('Checkout failed to load'))
    document.body.appendChild(script)
  })
}

export interface CheckoutHandoff {
  providerSubscriptionId: string
  keyId: string
  seats: number
}

/**
 * Hand off to Checkout.
 *
 * `onPaid` fires when the customer completes the sheet. It means the mandate is
 * registered — NOT that entitlement has been granted. The subscription is still
 * 'pending' at this point and becomes active when the webhook arrives from
 * Razorpay's servers, which is usually seconds but is not guaranteed to be
 * before the caller refreshes. Callers must word their success message
 * accordingly.
 */
export async function openRazorpayCheckout(
  session: CheckoutHandoff,
  options: {
    description: string
    onPaid: () => void
    onDismiss?: () => void
    onFailed?: () => void
  },
): Promise<void> {
  await loadCheckoutScript()
  if (!window.Razorpay) throw new Error('Checkout failed to load')

  const checkout = new window.Razorpay({
    key: session.keyId,
    subscription_id: session.providerSubscriptionId,
    name: 'Vektra Projects',
    description: options.description,
    theme: { color: '#111827' },
    handler: () => options.onPaid(),
    modal: { ondismiss: () => options.onDismiss?.() },
  })

  checkout.on('payment.failed', () => options.onFailed?.())
  checkout.open()
}
