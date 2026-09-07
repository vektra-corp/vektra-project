'use client'

import { Button, SegmentedGroup, SegmentedItem, toast } from '@pm/ui'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createProject } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/actions'

const FILTERS = ['All', 'Mine', 'At risk'] as const

/**
 * The projects header: title, the three scope tabs, and the New project toggle.
 *
 * The design creates a project from a row that unfolds under this header rather
 * than from a separate page — name, client, Create — so that is what this does.
 * The full form still exists at `projects/new` for everything the quick row does
 * not carry (dates, budget, visibility), and the row links to it.
 */
export function ProjectListHeader({
  title,
  orgSlug,
  workspaceSlug,
  base,
  canCreate,
}: {
  title: string
  orgSlug: string
  workspaceSlug: string
  base: string
  canCreate: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [pending, startTransition] = useTransition()

  const active = searchParams.get('scope') ?? 'All'

  function pickFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'All') params.delete('scope')
    else params.set('scope', value)
    const query = params.toString()
    router.replace(query ? `?${query}` : '?', { scroll: false })
  }

  function submit() {
    if (!name.trim()) return
    const formData = new FormData()
    formData.set('name', name.trim())
    if (client.trim()) formData.set('description', client.trim())

    startTransition(async () => {
      const result = await createProject(orgSlug, workspaceSlug, null, formData)
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not create', description: result.message })
        return
      }
      setName('')
      setClient('')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <div className="border-border flex shrink-0 items-center gap-3.5 border-b px-5 py-3">
        <h1 className="text-[15px] font-semibold">{title}</h1>

        <SegmentedGroup aria-label="Filter projects">
          {FILTERS.map((filter) => (
            <SegmentedItem
              key={filter}
              size="sm"
              active={active === filter}
              onClick={() => pickFilter(filter)}
            >
              {filter}
            </SegmentedItem>
          ))}
        </SegmentedGroup>

        {canCreate ? (
          <Button size="sm" className="ms-auto" onClick={() => setOpen((value) => !value)}>
            {open ? 'Close' : 'New project'}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="border-border bg-surface flex shrink-0 items-center gap-2.5 border-b px-5 py-3.5">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            placeholder="Project name"
            aria-label="Project name"
            autoFocus
            className="border-input bg-card placeholder:text-faint focus-visible:border-ring flex-1 rounded-lg border px-3 py-2.5 text-base outline-none"
          />
          <input
            value={client}
            onChange={(event) => setClient(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            placeholder="Client or team"
            aria-label="Client or team"
            className="border-input bg-card placeholder:text-faint focus-visible:border-ring w-[210px] rounded-lg border px-3 py-2.5 text-base outline-none"
          />
          <Button variant="accent" loading={pending} onClick={submit}>
            Create
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`${base}/new`}>More options</a>
          </Button>
        </div>
      ) : null}
    </>
  )
}
