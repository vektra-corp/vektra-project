import { Button } from '@pm/ui'
import { LogOut } from 'lucide-react'
import { adminSignOut } from '@/app/login/actions'

export function AdminSignOut() {
  return (
    <form action={adminSignOut}>
      <Button type="submit" variant="subtle" size="icon-sm" aria-label="Sign out">
        <LogOut className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </form>
  )
}
