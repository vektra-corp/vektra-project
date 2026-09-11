import 'server-only'

import type { ProjectAccess } from '@pm/auth/rbac'
import { resolveProjectSettings, type ProjectSettings } from '@pm/shared/constants'
import { appError } from '@pm/shared/errors'
import { cache } from 'react'
import type { RequestContext } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * The caller's standing in one project, plus that project's own policy.
 *
 * Both halves come from a single round trip because every gated action needs
 * both, and asking separately meant two queries on the critical path of every
 * task mutation.
 *
 * Cached per render: a page that checks "can I create?" for the header and
 * "can I edit?" for each row would otherwise re-query per check.
 */
export interface ResolvedProjectAccess extends ProjectAccess {
  projectId: string
  settings: ProjectSettings
}

export const loadProjectAccess = cache(
  async (auth: RequestContext, projectUuid: string): Promise<ResolvedProjectAccess> => {
    const supabase = createClient()

    const [{ data: project }, { data: membership }] = await Promise.all([
      supabase
        .from('projects')
        .select('id, settings')
        .eq('id', projectUuid)
        .eq('organization_id', auth.orgId)
        .maybeSingle(),
      supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectUuid)
        .eq('user_id', auth.userId)
        .maybeSingle(),
    ])

    // A project the caller cannot see reads as absent. Returning "no access"
    // rather than throwing would let a caller treat a missing project as a
    // permission problem and vice versa.
    if (!project) throw appError('NOT_FOUND', 'That project was not found.')

    const settings = resolveProjectSettings(project.settings)

    return {
      projectId: project.id,
      projectRole: (membership?.role as ProjectAccess['projectRole']) ?? null,
      orgRole: auth.orgRole,
      taskCreatePolicy: settings.taskCreate,
      settings,
    }
  },
)

/** Throw a 403 unless the predicate passes. Use at every project-scoped write. */
export function assertProjectAccess(
  allowed: boolean,
  message = 'You do not have access to do that in this project.',
): void {
  if (!allowed) throw appError('FORBIDDEN', message)
}
