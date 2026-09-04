'use client'

import * as React from 'react'
import type { ToastActionElement, ToastProps } from '../components/toast'

/**
 * Toast store.
 *
 * The queue lives outside React so a server action's `catch` block can raise a
 * toast without needing the hook's dispatch in scope. Subscribers re-render on
 * change; the list is capped so a failing loop cannot fill the screen.
 */
const TOAST_LIMIT = 3
const REMOVE_DELAY_MS = 4000

export interface ToasterToast extends Omit<ToastProps, 'title'> {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

let count = 0
function nextId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return String(count)
}

let memoryState: ToasterToast[] = []
const listeners = new Set<(state: ToasterToast[]) => void>()

function emit(next: ToasterToast[]) {
  memoryState = next
  for (const listener of listeners) listener(memoryState)
}

function dismiss(id?: string) {
  emit(memoryState.filter((t) => (id ? t.id !== id : false)))
}

export function toast(props: Omit<ToasterToast, 'id'>) {
  const id = nextId()

  emit([{ ...props, id, open: true }, ...memoryState].slice(0, TOAST_LIMIT))
  // Auto-dismiss. Radix animates the exit, so removal from state is enough.
  setTimeout(() => dismiss(id), REMOVE_DELAY_MS)

  return { id, dismiss: () => dismiss(id) }
}

export function useToast() {
  const [state, setState] = React.useState<ToasterToast[]>(memoryState)

  React.useEffect(() => {
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])

  return { toasts: state, toast, dismiss }
}
