import { Button } from '@pm/ui'
import { LogOut } from 'lucide-react'
import { adminSignOut } from '@/app/login/actions'

export function AdminSignOut() {
  return (
    <form action={adminSignOut}>
      <Button type="submit" variant="outline" size="sm">
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </Button>
    </form>
  )
}
