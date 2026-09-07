'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

/**
 * Sidebar footer control. Mirrors what ThemeScript reads on the next load.
 *
 * Drawn as the design draws it: a 26px square with an 8px radius, a hairline
 * border and the half-filled circle ◐ — not an icon button, so it reads as a
 * state switch rather than as an action.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const stored = window.localStorage.getItem('pm-theme')
    setTheme(stored === 'light' ? 'light' : 'dark')
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      window.localStorage.setItem('pm-theme', next)
    } catch {
      // A blocked storage API only costs persistence, not the toggle itself.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Toggle theme"
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="border-input text-muted-foreground hover:text-foreground hover:border-subtle focus-visible:ring-ring/60 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg border font-glyph text-nav leading-none transition-colors focus-visible:outline-none focus-visible:ring-2"
    >
      <span aria-hidden>◐</span>
    </button>
  )
}
