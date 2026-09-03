import { Button } from '@pm/ui'
import { ShieldX } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Access denied' }

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <ShieldX className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        You are not a member of this organization, or your access has been removed.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Go to your workspace</Link>
      </Button>
    </main>
  )
}
