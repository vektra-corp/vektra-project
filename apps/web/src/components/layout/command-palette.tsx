'use client'

import { cn } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { searchPalette, type PaletteResult } from '@/app/(dashboard)/[orgSlug]/palette-actions'
import { PALETTE_EVENT } from './palette-trigger'

/**
 * Every screen the palette can jump to, and where it lives.
 *
 * Screens are matched on the client because the list is fixed and known at
 * build time — typing "boa" should not cost a round trip to learn that Board
 * exists. Only rows that come out of the database are searched on the server.
 */
const SCREENS = [
  { label: 'Dashboard', path: 'dashboard' },
  { label: 'Inbox', path: 'notifications' },
  { label: 'My tasks', path: 'my-tasks' },
  { label: 'Projects', path: '' },
  { label: 'Members', path: 'members' },
  { label: 'Reports', path: 'reports' },
  { label: 'Search', path: 'search' },
  { label: 'Settings', path: 'settings' },
] as const

/**
 * ⌘K command palette.
 *
 * Opens over the whole shell, matches screens instantly and everything else
 * after a short debounce, and hands the keyboard the list: ↑ ↓ move, Enter
 * follows, Escape closes. Mounted once by the org layout, so every screen has
 * it without each one wiring it up.
 */
export function CommandPalette({
  orgSlug,
  /** Where "Projects" goes — the first workspace, when there is one. */
  projectsPath,
}: {
  orgSlug: string
  projectsPath: string | null
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<PaletteResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // ⌘K / Ctrl-K anywhere, Escape to leave.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
        return
      }
      if (event.key === 'Escape') setOpen(false)
    }
    function onRequest() {
      setOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener(PALETTE_EVENT, onRequest)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener(PALETTE_EVENT, onRequest)
    }
  }, [])

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
    else {
      setQuery('')
      setRemote([])
      setActive(0)
    }
  }, [open])

  // Debounced so a fast typist issues one query, not one per keystroke. The
  // guard against a stale response landing after a newer one is the `cancelled`
  // flag: without it, a slow early query can overwrite a fast later one.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setRemote([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const results = await searchPalette(orgSlug, query)
        if (cancelled) return
        setRemote([...results.tasks, ...results.projects, ...results.people])
      } catch {
        // A failed lookup leaves the screen matches in place rather than
        // blanking the palette; there is nothing useful to say about it here.
        if (!cancelled) setRemote([])
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, orgSlug])

  const needle = query.trim().toLowerCase()
  const screenResults: PaletteResult[] = SCREENS.filter(
    (screen) =>
      screen.label.toLowerCase().includes(needle) &&
      (screen.path !== '' || projectsPath !== null),
  ).map((screen) => ({
    kind: 'GO TO',
    label: screen.label,
    hint: 'screen',
    href: screen.path === '' ? (projectsPath as string) : `/${orgSlug}/${screen.path}`,
  }))

  const results = [...screenResults, ...remote].slice(0, 12)

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Command palette"
      onClick={() => setOpen(false)}
      className="bg-scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[110px]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="border-input bg-popover shadow-overlay flex w-[560px] max-w-full flex-col overflow-hidden rounded-[13px] border"
      >
        <div className="border-border flex items-center gap-2.5 border-b px-4 py-3.5">
          <span aria-hidden className="text-faint font-glyph">
            ⌕
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((index) => Math.min(index + 1, Math.max(0, results.length - 1)))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => Math.max(index - 1, 0))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const result = results[active] ?? results[0]
                if (result) go(result.href)
              }
            }}
            placeholder="Search screens, tasks, people…"
            aria-label="Search"
            className="placeholder:text-faint flex-1 bg-transparent text-[14px] outline-none"
          />
          <span className="border-input text-subtle rounded-[4px] border px-1.5 py-0.5 font-mono text-id">
            ESC
          </span>
        </div>

        <div className="scrollbar-slim flex max-h-[330px] flex-col overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="text-subtle px-2.5 py-4 text-ui">
              {needle.length < 2 ? 'Type to search.' : 'Nothing matches that.'}
            </p>
          ) : (
            results.map((result, index) => (
              <button
                key={`${result.kind}-${result.href}-${index}`}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => go(result.href)}
                className={cn(
                  'flex items-center gap-[11px] rounded-lg px-[11px] py-2.5 text-start transition-colors',
                  index === active ? 'bg-surface-hover' : 'hover:bg-surface-hover/60',
                )}
              >
                <span className="text-subtle w-[52px] shrink-0 truncate font-mono text-meta uppercase tracking-[0.1em]">
                  {result.kind}
                </span>
                <span className="truncate text-task">{result.label}</span>
                <span className="text-faint ms-auto shrink-0 truncate text-micro">
                  {result.hint}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
