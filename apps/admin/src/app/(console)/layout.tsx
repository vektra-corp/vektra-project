import type { ReactNode } from 'react'
import { AdminShell } from '@/components/admin-shell'
import { requireAdmin } from '@/lib/auth'

/**
 * Authenticated console shell.
 *
 * `requireAdmin` runs here and again in every page: this layout gates the
 * navigation, but a page reached directly must not depend on a layout having
 * run first (§2, fail closed).
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin()
  return <AdminShell admin={admin}>{children}</AdminShell>
}
