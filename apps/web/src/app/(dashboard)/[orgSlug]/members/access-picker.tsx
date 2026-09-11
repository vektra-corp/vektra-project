'use client'

import { Checkbox, cn } from '@pm/ui'

export interface PickerWorkspace {
  id: string
  name: string
}

export interface PickerProject {
  id: string
  name: string
  workspaceId: string
}

/**
 * Workspace and project selection, as one control.
 *
 * The two are shown together because they are one decision: a workspace grant
 * is what puts a workspace in someone's sidebar, and a project grant is what
 * RLS reads to let them open a board. Presenting them as separate steps is how
 * you end up with members who can sign in and see nothing.
 *
 * Ticking a project implies its workspace — stated here in the copy and
 * enforced on the server — so nobody has to know the rule to get a working
 * result.
 */
export function AccessPicker({
  workspaces,
  projects,
  selectedWorkspaces,
  selectedProjects,
  onToggleWorkspace,
  onToggleProject,
  workspacesReadOnly = false,
}: {
  workspaces: PickerWorkspace[]
  projects: PickerProject[]
  selectedWorkspaces: Set<string>
  selectedProjects: Set<string>
  onToggleWorkspace: (id: string) => void
  onToggleProject: (id: string) => void
  /**
   * True for a manager: RLS reserves workspace membership for admins, so the
   * boxes are shown checked-or-not but cannot be changed. Ticking a project
   * still adds its workspace — that grant is implied by work, not by policy.
   */
  workspacesReadOnly?: boolean
}) {
  if (workspaces.length === 0) {
    return (
      <p className="text-nav text-faint">
        This organization has no workspaces yet. Create one first — without it there is nothing to
        give access to.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {workspacesReadOnly ? (
        <p className="text-nav text-faint">
          Only an admin can change workspace membership. Choosing a project adds its workspace
          automatically.
        </p>
      ) : null}
      <div className="border-border-subtle scrollbar-slim max-h-64 space-y-3 overflow-y-auto rounded-md border p-3">
      {workspaces.map((workspace) => {
        const inWorkspace = projects.filter((project) => project.workspaceId === workspace.id)
        // A project implies its workspace, so a workspace with any project
        // ticked is shown ticked rather than letting the two disagree on screen.
        const implied = inWorkspace.some((project) => selectedProjects.has(project.id))
        const checked = selectedWorkspaces.has(workspace.id) || implied

        return (
          <div key={workspace.id} className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2.5 text-base font-medium">
              <Checkbox
                size="sm"
                checked={checked}
                disabled={implied || workspacesReadOnly}
                onChange={() => onToggleWorkspace(workspace.id)}
              />
              <span className={cn((implied || workspacesReadOnly) && 'text-muted-foreground')}>
                {workspace.name}
              </span>
            </label>

            {inWorkspace.length > 0 ? (
              <div className="space-y-1 ps-6">
                {inWorkspace.map((project) => (
                  <label
                    key={project.id}
                    className="text-muted-foreground flex cursor-pointer items-center gap-2.5 text-nav"
                  >
                    <Checkbox
                      size="sm"
                      checked={selectedProjects.has(project.id)}
                      onChange={() => onToggleProject(project.id)}
                    />
                    <span className="truncate">{project.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-faint ps-6 text-nav">No projects yet.</p>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}
