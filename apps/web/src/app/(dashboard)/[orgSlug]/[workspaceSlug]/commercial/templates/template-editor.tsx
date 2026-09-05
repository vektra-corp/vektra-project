'use client'

import {
  DEFAULT_PDF_TEMPLATE,
  PDF_COLUMNS,
  PDF_COLUMN_LABELS,
  PDF_FONTS,
  PDF_PAGE_SIZES,
  parsePdfTemplate,
  type PdfTemplate,
} from '@pm/shared/constants'
import { Alert, AlertDescription, Button, Checkbox, Input, Skeleton, toast } from '@pm/ui'
import { AlertCircle, Check, Star, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Field, SelectField } from '@/components/settings/settings-form'
import { deleteTemplate, saveTemplate, setDefaultTemplate } from './actions'

interface Scope {
  orgSlug: string
  workspaceSlug: string
}

export interface TemplateRecord {
  id: string
  name: string
  docType: string
  isDefault: boolean
  template: PdfTemplate
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" loading={pending}>
      Save template
    </Button>
  )
}

/**
 * Template editor with a live PDF preview.
 *
 * The preview renders server-side from the form's CURRENT values, not the saved
 * ones — a template editor that needs a save before showing the change is not
 * really an editor. That is safe because the preview route reduces whatever it
 * receives through `parsePdfTemplate` and uses its own fixed sample document.
 *
 * Rendering is CPU-bound, so requests are debounced and each one supersedes the
 * last: without that, dragging a number input would queue a render per
 * keystroke and the preview would settle on whichever finished last rather than
 * the newest.
 */
export function TemplateEditor({
  scope,
  template: record,
}: {
  scope: Scope
  template: TemplateRecord
}) {
  const [state, formAction] = useFormState(
    saveTemplate.bind(null, scope, record.id),
    null,
  )
  const [draft, setDraft] = useState<PdfTemplate>(record.template)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(true)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const requestId = useRef(0)

  const renderPreview = useCallback(
    async (next: PdfTemplate) => {
      const id = ++requestId.current
      setPreviewing(true)
      try {
        const response = await fetch(
          `/api/commercial/templates/preview?org=${encodeURIComponent(scope.orgSlug)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
          },
        )
        if (!response.ok) return
        const blob = await response.blob()
        // A slower earlier request must not overwrite a newer preview.
        if (id !== requestId.current) return
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old)
          return URL.createObjectURL(blob)
        })
      } catch {
        // A failed preview is not worth interrupting the edit for.
      } finally {
        if (id === requestId.current) setPreviewing(false)
      }
    },
    [scope.orgSlug],
  )

  useEffect(() => {
    const timer = setTimeout(() => void renderPreview(draft), 400)
    return () => clearTimeout(timer)
  }, [draft, renderPreview])

  // Blob URLs are held by the browser until revoked; without this an hour of
  // editing leaks every preview it produced.
  useEffect(() => () => setPreviewUrl((url) => {
    if (url) URL.revokeObjectURL(url)
    return null
  }), [])

  useEffect(() => {
    if (state?.ok) {
      toast({ title: 'Template saved' })
      router.refresh()
    }
  }, [state, router])

  /** Re-read the whole form so the preview always matches what is on screen. */
  const onFormChange = (event: React.FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget
    const data = new FormData(form)
    setDraft(
      parsePdfTemplate({
        accentColor: data.get('accentColor'),
        textColor: data.get('textColor'),
        mutedColor: data.get('mutedColor'),
        fontFamily: data.get('fontFamily'),
        fontSize: Number(data.get('fontSize')),
        pageSize: data.get('pageSize'),
        margin: Number(data.get('margin')),
        accentBar: data.get('accentBar') === 'on',
        showLogo: data.get('showLogo') === 'on',
        headerTitle: data.get('headerTitle'),
        footerText: data.get('footerText'),
        columns: data.getAll('columns'),
        showNotes: data.get('showNotes') === 'on',
        showTerms: data.get('showTerms') === 'on',
        showPaymentSummary: data.get('showPaymentSummary') === 'on',
      }),
    )
  }

  const t = record.template

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <form
        action={formAction}
        onChange={onFormChange}
        className="space-y-5 rounded-lg border border-border bg-surface p-5 shadow-card"
      >
        {state && !state.ok ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        <Field id="tpl-name" label="Template name">
          <Input id="tpl-name" name="name" defaultValue={record.name} required maxLength={80} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id="tpl-page" label="Page size">
            <SelectField
              id="tpl-page"
              name="pageSize"
              defaultValue={t.pageSize}
              options={PDF_PAGE_SIZES.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field id="tpl-font" label="Font">
            <SelectField
              id="tpl-font"
              name="fontFamily"
              defaultValue={t.fontFamily}
              options={PDF_FONTS.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field id="tpl-size" label="Text size" hint="6-14pt.">
            <Input
              id="tpl-size"
              name="fontSize"
              type="number"
              min={6}
              max={14}
              defaultValue={t.fontSize}
            />
          </Field>
          <Field id="tpl-margin" label="Margin" hint="16-110pt.">
            <Input
              id="tpl-margin"
              name="margin"
              type="number"
              min={16}
              max={110}
              defaultValue={t.margin}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field id="tpl-accent" label="Accent">
            <Input id="tpl-accent" name="accentColor" type="color" defaultValue={t.accentColor} />
          </Field>
          <Field id="tpl-text" label="Text">
            <Input id="tpl-text" name="textColor" type="color" defaultValue={t.textColor} />
          </Field>
          <Field id="tpl-muted" label="Secondary">
            <Input id="tpl-muted" name="mutedColor" type="color" defaultValue={t.mutedColor} />
          </Field>
        </div>

        <Field id="tpl-title" label="Heading override" hint="Blank uses the document type.">
          <Input
            id="tpl-title"
            name="headerTitle"
            maxLength={40}
            placeholder="TAX INVOICE"
            defaultValue={t.headerTitle}
          />
        </Field>

        <Field id="tpl-footer" label="Footer" hint="Blank uses the document number and org name.">
          <Input id="tpl-footer" name="footerText" maxLength={200} defaultValue={t.footerText} />
        </Field>

        <fieldset className="space-y-2">
          <legend className="label-meta pb-1 text-faint">Line-item columns</legend>
          {PDF_COLUMNS.map((column) => (
            <label key={column} className="flex items-center gap-2 text-base">
              <Checkbox
                name="columns"
                value={column}
                defaultChecked={t.columns.includes(column)}
              />
              {PDF_COLUMN_LABELS[column]}
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="label-meta pb-1 text-faint">Sections</legend>
          {(
            [
              ['showNotes', 'Notes', t.showNotes],
              ['showTerms', 'Terms', t.showTerms],
              ['showPaymentSummary', 'Paid / outstanding', t.showPaymentSummary],
              ['accentBar', 'Accent bar across the top', t.accentBar],
              ['showLogo', 'Organization logo', t.showLogo],
            ] as const
          ).map(([name, label, checked]) => (
            <label key={name} className="flex items-center gap-2 text-base">
              <Checkbox name={name} defaultChecked={checked} />
              {label}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
          <SubmitButton />

          {record.isDefault ? (
            <span className="label-meta inline-flex items-center gap-1 text-faint">
              <Check className="h-3 w-3" aria-hidden />
              Default for {record.docType.replace('_', ' ')}
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await setDefaultTemplate(scope, record.id)
                  if (result.ok) router.refresh()
                  else toast({ title: result.message, variant: 'destructive' })
                })
              }
            >
              <Star className="h-3.5 w-3.5" aria-hidden />
              Make default
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ms-auto text-danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteTemplate(scope, record.id)
                if (result.ok) router.refresh()
                else toast({ title: result.message, variant: 'destructive' })
              })
            }
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </Button>
        </div>
      </form>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="label-meta text-faint">Preview</p>
          {previewing ? <span className="label-meta text-faint">Rendering…</span> : null}
        </div>

        {previewUrl ? (
          <object
            data={previewUrl}
            type="application/pdf"
            className="h-[42rem] w-full rounded-lg border border-border bg-surface"
            aria-label="Template preview"
          >
            {/* Browsers without an inline PDF viewer get a link rather than a blank box. */}
            <a href={previewUrl} className="text-brand underline">
              Open the preview
            </a>
          </object>
        ) : (
          <Skeleton className="h-[42rem] w-full rounded-lg" />
        )}

        <p className="text-nav text-faint">
          Rendered from sample data. The logo is not shown in previews.
        </p>
      </div>
    </div>
  )
}

export { DEFAULT_PDF_TEMPLATE }
