'use client'

import { Button } from '@pm/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SelectField } from '@/components/settings/settings-form'

/**
 * Filters and paging for the audit log.
 *
 * State lives in the URL, not in component state, so a filtered view survives a
 * refresh and can be shared or bookmarked (§10, URL state).
 */

const ACTOR_TYPES = ['user', 'admin', 'system', 'workflow', 'integration']

function hrefFor(
  orgSlug: string,
  next: { actor?: string; resource?: string; page?: number },
): string {
  const query = new URLSearchParams()
  if (next.actor) query.set('actor', next.actor)
  if (next.resource) query.set('resource', next.resource)
  if (next.page) query.set('page', String(next.page))
  const suffix = query.toString()
  return `/${orgSlug}/settings/audit-log${suffix ? `?${suffix}` : ''}`
}

export function AuditFilters({
  orgSlug,
  resourceTypes,
  actor,
  resource,
}: {
  orgSlug: string
  resourceTypes: string[]
  actor: string
  resource: string
}) {
  const router = useRouter()

  // Changing a filter resets to the first page: page 3 of the old filter is
  // rarely page 3 of the new one.
  const go = (next: { actor?: string; resource?: string }) => {
    router.push(hrefFor(orgSlug, { actor, resource, ...next }))
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-44">
        <label htmlFor="audit-actor" className="label-meta block pb-1.5 text-faint">
          Actor
        </label>
        <div
          onChange={(event) => go({ actor: (event.target as HTMLSelectElement).value })}
        >
          <SelectField
            id="audit-actor"
            name="actor"
            defaultValue={actor}
            options={[
              { value: '', label: 'Anyone' },
              ...ACTOR_TYPES.map((value) => ({ value, label: value })),
            ]}
          />
        </div>
      </div>

      <div className="w-52">
        <label htmlFor="audit-resource" className="label-meta block pb-1.5 text-faint">
          Resource
        </label>
        <div
          onChange={(event) => go({ resource: (event.target as HTMLSelectElement).value })}
        >
          <SelectField
            id="audit-resource"
            name="resource"
            defaultValue={resource}
            options={[
              { value: '', label: 'Everything' },
              ...resourceTypes.map((value) => ({ value, label: value })),
            ]}
          />
        </div>
      </div>

      {actor || resource ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={hrefFor(orgSlug, {})}>Clear</Link>
        </Button>
      ) : null}
    </div>
  )
}

/*
 * A separate named export, not `AuditFilters.Pager`.
 *
 * The RSC client manifest is built from a module's named exports, so a
 * component attached as a static property of another one cannot be resolved
 * when a server component renders it — "Could not find the module ... in the
 * React Client Manifest" at request time, with nothing wrong at build time.
 */
export function AuditPager({
  orgSlug,
  page,
  hasMore,
  actor,
  resource,
}: {
  orgSlug: string
  page: number
  hasMore: boolean
  actor: string
  resource: string
}) {
  if (page === 0 && !hasMore) return null

  return (
    <div className="flex items-center justify-between">
      <Button asChild variant="outline" size="sm" disabled={page === 0}>
        <Link href={hrefFor(orgSlug, { actor, resource, page: Math.max(0, page - 1) })}>
          Previous
        </Link>
      </Button>
      <span className="label-meta text-faint">Page {page + 1}</span>
      <Button asChild variant="outline" size="sm" disabled={!hasMore}>
        <Link href={hrefFor(orgSlug, { actor, resource, page: page + 1 })}>Next</Link>
      </Button>
    </div>
  )
}
