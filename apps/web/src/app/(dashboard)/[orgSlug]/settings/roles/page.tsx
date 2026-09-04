import {
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  ORG_ADMIN_ROLES,
} from '@pm/auth/constants'
import { hasPermission } from '@pm/auth/rbac'
import { ACTIONS, MODULES, ORG_ROLES } from '@pm/shared/constants'
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pm/ui'
import { Check, Minus } from 'lucide-react'
import type { Metadata } from 'next'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'

export const metadata: Metadata = { title: 'Roles' }

/**
 * The permission matrix, rendered from the same evaluator the server enforces.
 *
 * Reading it out of `hasPermission` rather than restating it here means the page
 * cannot drift from the rule that is actually applied — a documentation table
 * that disagrees with the code is worse than no table.
 */
export default async function RolesSettingsPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  return (
    <PageBody>
      <div className="max-w-4xl space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {ORG_ROLES.map((role) => (
            <div key={role} className="rounded-lg border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-semibold">{ORG_ROLE_LABELS[role]}</h2>
                {role === auth.orgRole ? (
                  <Badge variant="secondary" shape="meta">
                    You
                  </Badge>
                ) : null}
              </div>
              <p className="pt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {ORG_ROLE_DESCRIPTIONS[role]}
              </p>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold">Permission matrix</h2>
            <p className="pt-1 text-[13px] text-muted-foreground">
              System roles are fixed. Custom roles are an Enterprise feature and arrive with the
              commercial modules.
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Capability</TableHead>
                {ORG_ROLES.map((role) => (
                  <TableHead key={role} className="text-center">
                    {ORG_ROLE_LABELS[role]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {MODULES.flatMap((module) =>
                ACTIONS.map((action) => {
                  // Skip rows no role holds, e.g. billing.create — an all-empty
                  // row teaches the reader nothing.
                  const anyRoleHas = ORG_ROLES.some((role) => hasPermission(role, module, action))
                  if (!anyRoleHas) return null

                  return (
                    <TableRow key={`${module}.${action}`}>
                      <TableCell className="text-[13px]">
                        <span className="text-muted-foreground">{module}</span>
                        <span className="px-1 text-faint">.</span>
                        <span>{action}</span>
                      </TableCell>
                      {ORG_ROLES.map((role) => (
                        <TableCell key={role} className="text-center">
                          {hasPermission(role, module, action) ? (
                            <Check
                              className="mx-auto h-3.5 w-3.5 text-success"
                              aria-label="Allowed"
                            />
                          ) : (
                            <Minus
                              className="mx-auto h-3.5 w-3.5 text-faint"
                              aria-label="Not allowed"
                            />
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                }),
              ).filter(Boolean)}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageBody>
  )
}
