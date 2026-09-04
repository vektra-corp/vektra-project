'use client'

import { Input } from '@pm/ui'
import { Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Search box.
 *
 * The query lives in the URL so a result set can be shared and survives a
 * refresh (§10). Typing is debounced by 300ms (§23.2 rule 6) so a five-letter
 * word is one query, not five.
 */
export function SearchInput({ initialQuery }: { initialQuery: string }) {
  const [value, setValue] = useState(initialQuery)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (value === initialQuery) return

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (value.trim()) params.set('q', value.trim())
      else params.delete('q')
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    }, 300)

    return () => clearTimeout(timer)
  }, [value, initialQuery, pathname, router, searchParams])

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
        aria-hidden
      />
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search tasks and projects…"
        aria-label="Search"
        className="h-11 ps-9 text-[13px]"
      />
    </div>
  )
}
