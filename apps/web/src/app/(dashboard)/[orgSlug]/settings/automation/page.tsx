import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { Badge } from '@pm/ui'
import { Workflow } from 'lucide-react'
import type { Metadata } from 'next'
import { SettingsPanel } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { DeleteRuleButton, RuleToggle } from './rule-controls'
import { RuleDialog, type RuleRecord } from './rule-dialog'

export const metadata: Metadata = { title: 'Automation' }

const METHOD_LABELS: Record<string, string> = {
  round_robin: 'Round robin',
  load_balanced: 'Load balanced',
  skill_based: 'Skill based',
  random: 'Random',
}

export default async function AutomationSettingsPage({
  params,
}: {
  params: { orgSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const supabase = createClient()

  const [{ data: rules }, { data: members }, { data: projects }] = await Promise.all([
    supabase
      .from('auto_assignment_rules')
      .select('id, name, is_active, method, project_id, assignee_pool, conditions, config')
      .eq('organization_id', auth.orgId)
      .order('name'),
    supabase
      .from('org_members')
      .select('user_id, profile:profiles!org_members_user_id_fkey(full_name)')
      .eq('organization_id', auth.orgId),
    supabase
      .from('projects')
      .select('id, name')
      .eq('organization_id', auth.orgId)
      .eq('status', 'active')
      .order('name'),
  ])

  const memberOptions = (members ?? [])
    .map((member) => {
      const profile = Array.isArray(member.profile) ? member.profile[0] : member.profile
      return profile ? { userId: member.user_id, fullName: profile.full_name } : null
    })
    .filter((member): member is { userId: string; fullName: string } => member !== null)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))

  const nameFor = new Map(memberOptions.map((member) => [member.userId, member.fullName]))
  const projectFor = new Map((projects ?? []).map((project) => [project.id, project.name]))

  const asStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

  const rows: RuleRecord[] = (rules ?? []).map((rule) => {
    const conditions = (rule.conditions ?? {}) as Record<string, unknown>
    const config = (rule.config ?? {}) as Record<string, unknown>

    return {
      id: rule.id,
      name: rule.name,
      isActive: rule.is_active,
      method: rule.method,
      projectId: rule.project_id,
      assigneePool: (rule.assignee_pool ?? []) as string[],
      priorities: asStrings(conditions.priority),
      labels: asStrings(conditions.labels),
      requiredSkills: asStrings(config.required_skills),
      maxConcurrent:
        typeof config.max_concurrent === 'number' ? config.max_concurrent : null,
      respectLeave: config.respect_leave !== false,
    }
  })

  return (
    <SettingsPanel>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base text-muted-foreground">
            Assign new tasks automatically. Rules run every couple of minutes against tasks created
            in the last hour that still have no assignee.
          </p>
          <RuleDialog
            orgSlug={params.orgSlug}
            members={memberOptions}
            projects={projects ?? []}
          />
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
            <Workflow className="h-6 w-6 text-faint" aria-hidden />
            <p className="pt-3 text-base text-muted-foreground">No assignment rules yet.</p>
            <p className="pt-1 max-w-sm text-nav text-faint">
              A rule with no conditions catches every new task; add a priority or label to narrow
              it.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {rows.map((rule) => (
              <li key={rule.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      rule.isActive ? 'bg-success' : 'bg-faint'
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {rule.name}
                  </span>

                  <Badge variant="secondary" shape="meta">
                    {METHOD_LABELS[rule.method] ?? rule.method}
                  </Badge>

                  <RuleToggle
                    orgSlug={params.orgSlug}
                    ruleId={rule.id}
                    isActive={rule.isActive}
                  />
                  <RuleDialog
                    orgSlug={params.orgSlug}
                    rule={rule}
                    members={memberOptions}
                    projects={projects ?? []}
                  />
                  <DeleteRuleButton orgSlug={params.orgSlug} ruleId={rule.id} />
                </div>

                <p className="label-meta pt-2 text-faint">
                  {rule.projectId ? (projectFor.get(rule.projectId) ?? 'One project') : 'All projects'}
                  <span className="px-1.5 opacity-50">·</span>
                  {rule.assigneePool.length} assignee
                  {rule.assigneePool.length === 1 ? '' : 's'}
                  {rule.priorities.length > 0 ? (
                    <>
                      <span className="px-1.5 opacity-50">·</span>
                      {rule.priorities.join(', ')}
                    </>
                  ) : null}
                  {rule.labels.length > 0 ? (
                    <>
                      <span className="px-1.5 opacity-50">·</span>
                      {rule.labels.map((label) => `#${label}`).join(' ')}
                    </>
                  ) : null}
                  {rule.respectLeave ? (
                    <>
                      <span className="px-1.5 opacity-50">·</span>
                      skips leave
                    </>
                  ) : null}
                </p>

                {rule.assigneePool.length > 0 ? (
                  <p className="pt-1 text-nav text-muted-foreground">
                    {rule.assigneePool
                      .map((userId) => nameFor.get(userId) ?? 'Unknown')
                      .join(' → ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsPanel>
  )
}
