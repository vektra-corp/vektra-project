import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_TYPE_LABELS,
  parseFieldOptions,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@pm/shared/constants'
import { Badge } from '@pm/ui'
import { SlidersHorizontal } from 'lucide-react'
import type { Metadata } from 'next'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { DeleteFieldButton, FieldDialog, type FieldRecord } from './field-dialog'

export const metadata: Metadata = { title: 'Custom fields' }

export default async function CustomFieldsPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const supabase = createClient()

  const [{ data: fields }, { data: values }] = await Promise.all([
    supabase
      .from('custom_fields')
      .select('id, entity_type, name, field_type, options, is_required, position')
      .eq('organization_id', auth.orgId)
      .order('entity_type')
      .order('position'),
    // Counted in memory so the delete dialog can say how much would be lost.
    supabase
      .from('custom_field_values')
      .select('custom_field_id')
      .eq('organization_id', auth.orgId),
  ])

  const valueCounts = new Map<string, number>()
  for (const value of values ?? []) {
    valueCounts.set(value.custom_field_id, (valueCounts.get(value.custom_field_id) ?? 0) + 1)
  }

  const rows: FieldRecord[] = (fields ?? []).map((field) => ({
    id: field.id,
    entityType: field.entity_type,
    name: field.name,
    fieldType: field.field_type,
    options: parseFieldOptions(field.options),
    isRequired: field.is_required,
    position: field.position,
    valueCount: valueCounts.get(field.id) ?? 0,
  }))

  return (
    <PageBody>
      <div className="max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">
            Extra fields on tasks, projects, contacts and commercial documents.
          </p>
          <FieldDialog orgSlug={params.orgSlug} />
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
            <SlidersHorizontal className="h-6 w-6 text-faint" aria-hidden />
            <p className="pt-3 text-[13px] text-muted-foreground">No custom fields yet.</p>
          </div>
        ) : (
          CUSTOM_FIELD_ENTITIES.map((entity) => {
            const forEntity = rows.filter((row) => row.entityType === entity)
            if (forEntity.length === 0) return null

            return (
              <section
                key={entity}
                className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
              >
                <header className="border-b border-border-subtle px-4 py-2.5">
                  <h2 className="label-meta text-faint">
                    {CUSTOM_FIELD_ENTITY_LABELS[entity as CustomFieldEntity]}
                  </h2>
                </header>

                <ul className="divide-y divide-border-subtle">
                  {forEntity.map((field) => (
                    <li key={field.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="label-meta w-8 shrink-0 text-faint">{field.position}</span>

                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-[13px] font-medium">
                          <span className="truncate">{field.name}</span>
                          {field.isRequired ? (
                            <Badge variant="warning" shape="meta">
                              Required
                            </Badge>
                          ) : null}
                        </p>
                        {field.options.length > 0 ? (
                          <p className="label-meta pt-1 truncate text-faint">
                            {field.options.join(' · ')}
                          </p>
                        ) : null}
                      </div>

                      {field.valueCount > 0 ? (
                        <span className="label-meta text-faint">{field.valueCount} used</span>
                      ) : null}

                      <Badge variant="secondary" shape="meta">
                        {CUSTOM_FIELD_TYPE_LABELS[field.fieldType as CustomFieldType]}
                      </Badge>

                      <FieldDialog orgSlug={params.orgSlug} field={field} />
                      <DeleteFieldButton orgSlug={params.orgSlug} field={field} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </div>
    </PageBody>
  )
}
