'use client'

import { cn } from '@pm/ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface InlineOption {
  value: string
  label: string
  /** Dot shown before the label — status colours, label colours. */
  color?: string
  /** Colours the label itself instead, as the priority menu does. */
  inkColor?: string
}

/**
 * The small dropdown the design uses inside a list row.
 *
 * It is not the shared `DropdownMenu`: these sit inside a dense grid, open
 * against the row rather than in a portal, and are drawn at the design's own
 * 8px-radius / 14px-shadow menu size. Building it here keeps the row's markup
 * the design's markup, and keeps the heavier primitive for real menus.
 *
 * The trigger is whatever the caller renders — a status chip, an avatar, a
 * mono due date — so one component covers all five editable columns.
 */
export function InlineSelect({
  value,
  options,
  onPick,
  children,
  align = 'start',
  width = 136,
  menuAbove = false,
  disabled = false,
  label,
  className,
}: {
  value: string | null
  options: InlineOption[]
  onPick: (value: string) => void
  /** The trigger's contents. */
  children: ReactNode
  align?: 'start' | 'end'
  width?: number
  /** Opens upward — for the add row pinned at the foot of a group. */
  menuAbove?: boolean
  disabled?: boolean
  /** Accessible name for the trigger. */
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full min-w-0 items-center gap-1.5 text-start disabled:cursor-default"
      >
        {children}
      </button>

      {open ? (
        <div
          role="listbox"
          style={{ width }}
          className={cn(
            'border-input bg-popover shadow-raised absolute z-20 flex flex-col gap-px rounded-lg border p-1',
            menuAbove ? 'bottom-[26px]' : 'top-[26px]',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                setOpen(false)
                if (option.value !== value) onPick(option.value)
              }}
              className={cn(
                'hover:bg-surface-hover flex items-center gap-[7px] rounded-[5px] px-2 py-1.5 text-start text-micro transition-colors',
                option.value === value && 'bg-surface-hover',
              )}
              style={option.inkColor ? { color: option.inkColor } : undefined}
            >
              {option.color ? (
                <span
                  aria-hidden
                  className="h-[5px] w-[5px] shrink-0 rounded-full"
                  style={{ backgroundColor: option.color }}
                />
              ) : null}
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
