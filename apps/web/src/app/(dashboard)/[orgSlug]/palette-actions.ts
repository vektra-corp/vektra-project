'use server'

import { publicIdToString } from '@pm/shared/utils'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export interface PaletteResult {
  /** The mono tag on the left: a task key, PERSON, PROJECT. */
  kind: string
  label: string
  /** Right-hand caption: a status, a role, a workspace. */
  hint: string
  href: string
}

/**
 * Command-palette search over tasks, projects and people.
 *
 * Screens are matched on the client — they are a fixed list and need no round
 * trip — so this covers only what lives in the database. RLS scopes every query,
 * so the palette can never surface another tenant's work, and `requireAuth`
 * makes membership of the named org a precondition of running at all.
 *
 * Like §22.5's search page, this is `ilike` against titles: the dedicated search
 * engine in phase 3 replaces it when full-text across descriptions is needed.
 */
export async function searchPalette(
  orgSlug: string,
  query: string,
): Promise<{ tasks: PaletteResult[]; projects: PaletteResult[]; people: PaletteResult[] }> {
  const auth = await requireAuth(orgSlug)
  const trimmed = query.trim()
  if (trimmed.length < 2) return { tasks: [], projects: [], people: [] }

  const supabase = createClient()
  // Escape the LIKE wildcards so a literal % does not match everything.
  const pattern = `%${trimmed.replace(/[%_\\]/g, (char) => `\\${char}`)}%`

  const [{ data: tasks }, { data: projects }, { data: members }] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        `public_id, title, status, task_number,
         project:projects!tasks_project_id_fkey(
           public_id, key,
           workspace:workspaces!projects_workspace_id_fkey(slug)
         )`,
      )
      .eq('organization_id', auth.orgId)
      .ilike('title', pattern)
      .limit(6),
    supabase
      .from('projects')
      .select('public_id, name, key, workspace:workspaces!projects_workspace_id_fkey(slug, name)')
      .eq('organization_id', auth.orgId)
      .ilike('name', pattern)
      .limit(4),
    supabase
      .from('org_members')
      .select('role, profile:profiles!org_members_user_id_fkey(id, full_name)')
      .eq('organization_id', auth.orgId)
      .limit(50),
  ])

  const one = <T,>(value: T | T[] | null | undefined): T | null =>
    !value ? null : Array.isArray(value) ? (value[0] ?? null) : value

  const needle = trimmed.toLowerCase()

  return {
    tasks: (tasks ?? []).flatMap((task) => {
      const project = one(task.project)
      const workspace = project ? one(project.workspace) : null
      if (!project || !workspace) return []
      return [
        {
          kind: `${project.key}-${task.task_number}`,
          label: task.title,
          hint: String(task.status).replace('_', ' '),
          href: `/${orgSlug}/${workspace.slug}/projects/${publicIdToString(project.public_id)}/tasks/${publicIdToString(task.public_id)}`,
        },
      ]
    }),
    projects: (projects ?? []).flatMap((project) => {
      const workspace = one(project.workspace)
      if (!workspace) return []
      return [
        {
          kind: 'PROJECT',
          label: project.name,
          hint: workspace.name,
          href: `/${orgSlug}/${workspace.slug}/projects/${publicIdToString(project.public_id)}/board`,
        },
      ]
    }),
    // Members are filtered here rather than in the query: the name lives on the
    // embedded profile, and PostgREST cannot filter an embed's column without
    // turning the embed into an inner join, which would drop members whose
    // profile row is not yet readable.
    people: (members ?? [])
      .flatMap((member) => {
        const profile = one(member.profile)
        if (!profile || !profile.full_name.toLowerCase().includes(needle)) return []
        return [
          {
            kind: 'PERSON',
            label: profile.full_name,
            hint: member.role,
            href: `/${orgSlug}/members`,
          },
        ]
      })
      .slice(0, 3),
  }
}
