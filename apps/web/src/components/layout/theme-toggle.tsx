'use client'

import { Button } from '@pm/ui'
import { Contrast } from 'lucide-react'
import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

/** Sidebar footer control. Mirrors what ThemeScript reads on the next load. */
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
    <Button
      type="button"
      variant="subtle"
      size="icon-sm"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <Contrast className="h-3.5 w-3.5" aria-hidden />
    </Button>
  )
}
