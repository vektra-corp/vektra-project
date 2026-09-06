'use client'

import { initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, cn } from '@pm/ui'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { searchMentionableMembers, type MentionCandidate } from './mention-actions'

/**
 * The @mention typeahead.
 *
 * Rendered into a plain absolutely-positioned div rather than through a popup
 * library: the list only ever needs to sit under the caret, and Tiptap already
 * hands us the caret's client rect, so a positioning dependency would buy
 * nothing. It is appended to `document.body` so an editor inside a scrolling
 * panel cannot clip it.
 *
 * Keyboard handling is the part that matters. While the list is open the arrow
 * keys and Enter belong to it, not to the editor — `onKeyDown` returns true to
 * say "handled", which is how Tiptap knows not to move the caret or insert a
 * newline.
 */

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const MentionList = forwardRef<
  MentionListHandle,
  { items: MentionCandidate[]; command: (item: { id: string; label: string }) => void }
>(function MentionList({ items, command }, ref) {
  const [selected, setSelected] = useState(0)

  // A new query means a new list; keeping the old index would highlight
  // whichever name happened to land in that position.
  useEffect(() => setSelected(0), [items])

  const choose = (index: number) => {
    const item = items[index]
    if (item) command({ id: item.id, label: item.full_name })
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) return false

      if (event.key === 'ArrowUp') {
        setSelected((current) => (current + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((current) => (current + 1) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        choose(selected)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    return (
      <div className="border-border bg-surface text-faint w-56 rounded-lg border px-3 py-2 text-nav shadow-lg">
        No one to mention here
      </div>
    )
  }

  return (
    <ul
      className="border-border bg-surface max-h-64 w-56 overflow-y-auto rounded-lg border py-1 shadow-lg"
      role="listbox"
    >
      {items.map((item, index) => (
        <li key={item.id} role="option" aria-selected={index === selected}>
          <button
            type="button"
            // Mouse-down would blur the editor and lose the range the mention
            // is about to replace.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setSelected(index)}
            onClick={() => choose(index)}
            className={cn(
              'flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-ui transition-colors',
              index === selected ? 'bg-surface-hover text-foreground' : 'text-muted-foreground',
            )}
          >
            <Avatar className="h-5 w-5 shrink-0">
              {item.avatar_url ? <AvatarImage src={item.avatar_url} alt="" /> : null}
              <AvatarFallback className="text-[9px]">{initials(item.full_name)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate">{item.full_name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
})

/**
 * Build the suggestion config for one editor.
 *
 * `orgSlug` and `taskId` are closed over rather than read from a store: the
 * server action needs both to decide who is mentionable, and an editor that
 * does not know its task must not fall back to a wider list.
 */
export function mentionSuggestion(
  orgSlug: string,
  taskId: string,
): Omit<SuggestionOptions<MentionCandidate>, 'editor'> {
  return {
    char: '@',
    // Without this a mid-word "@" — an email address being typed, say — would
    // open the picker.
    allowSpaces: false,

    items: async ({ query }) => {
      const result = await searchMentionableMembers(orgSlug, taskId, query)
      return result.ok ? result.data : []
    },

    render: () => {
      let container: HTMLDivElement | null = null
      let root: Root | null = null
      let handle: MentionListHandle | null = null

      const place = (rect: DOMRect | null) => {
        if (!container || !rect) return
        // Flip above the caret when the list would otherwise run off the
        // bottom of the viewport.
        const below = window.innerHeight - rect.bottom
        const top = below < 280 ? rect.top - 8 : rect.bottom + 8
        container.style.left = `${Math.round(rect.left)}px`
        container.style.top = `${Math.round(top)}px`
        container.style.transform = below < 280 ? 'translateY(-100%)' : ''
      }

      const draw = (props: {
        items: MentionCandidate[]
        command: (item: { id: string; label: string }) => void
      }) => {
        root?.render(
          <MentionList
            ref={(instance) => {
              handle = instance
            }}
            items={props.items}
            command={props.command}
          />,
        )
      }

      return {
        onStart: (props) => {
          container = document.createElement('div')
          container.style.position = 'fixed'
          container.style.zIndex = '60'
          document.body.append(container)
          root = createRoot(container)
          draw(props)
          place(props.clientRect?.() ?? null)
        },

        onUpdate: (props) => {
          draw(props)
          place(props.clientRect?.() ?? null)
        },

        onKeyDown: (props) => {
          if (props.event.key === 'Escape') return true
          return handle?.onKeyDown(props.event) ?? false
        },

        onExit: () => {
          // Unmounting synchronously inside React's own commit throws, and this
          // runs from a ProseMirror plugin that may be mid-render.
          const dying = { root, container }
          root = null
          container = null
          handle = null
          queueMicrotask(() => {
            dying.root?.unmount()
            dying.container?.remove()
          })
        },
      }
    },
  }
}
