import { can } from '@pm/auth/rbac'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { ProjectForm } from '@/components/projects/project-form'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'

export const metadata: Metadata = { title: 'New project' }

export default async function NewProjectPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  // Members can read projects but not create them (§8 matrix).
  if (!can(auth, 'projects', 'create')) forbidden()

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>
            A board with To Do, In Progress, In Review and Done is created for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm orgSlug={params.orgSlug} workspaceSlug={params.workspaceSlug} />
        </CardContent>
      </Card>
    </div>
  )
}
