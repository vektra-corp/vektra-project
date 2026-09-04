'use client'

import { Separator, cn } from '@pm/ui'
/* eslint-disable import/no-named-as-default -- Tiptap extensions are default exports that share their module's name. */
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
/* eslint-enable import/no-named-as-default */
import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

/**
 * Rich text editor (§3: Tiptap 2.x).
 *
 * Emits the document as JSON into a hidden input, so the surrounding form posts
 * it like any other field and the server action receives it through FormData —
 * no client-side fetch, and progressive-enhancement stays intact for everything
 * else on the form. The JSON is sanitized server-side before storage (§13.1);
 * nothing here is treated as trusted.
 */

const TOOLBAR = [
  { key: 'bold', icon: Bold, label: 'Bold', mark: 'bold' },
  { key: 'italic', icon: Italic, label: 'Italic', mark: 'italic' },
  { key: 'strike', icon: Strikethrough, label: 'Strikethrough', mark: 'strike' },
  { key: 'code', icon: Code, label: 'Inline code', mark: 'code' },
] as const

const BLOCKS = [
  { key: 'bulletList', icon: List, label: 'Bullet list' },
  { key: 'orderedList', icon: ListOrdered, label: 'Numbered list' },
  { key: 'blockquote', icon: Quote, label: 'Quote' },
] as const

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      // Mouse-down default would blur the editor and drop the selection before
      // the command runs.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
        active ? 'bg-surface-hover text-foreground' : 'text-faint hover:text-muted-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const addLink = useCallback(() => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border-subtle px-1.5 py-1">
      {TOOLBAR.map((item) => (
        <ToolbarButton
          key={item.key}
          label={item.label}
          active={editor.isActive(item.mark)}
          onClick={() => editor.chain().focus().toggleMark(item.mark).run()}
        >
          <item.icon className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
      ))}

      <Separator orientation="vertical" className="mx-1 h-4" />

      {BLOCKS.map((item) => (
        <ToolbarButton
          key={item.key}
          label={item.label}
          active={editor.isActive(item.key)}
          onClick={() => {
            const chain = editor.chain().focus()
            if (item.key === 'bulletList') chain.toggleBulletList().run()
            else if (item.key === 'orderedList') chain.toggleOrderedList().run()
            else chain.toggleBlockquote().run()
          }}
        >
          <item.icon className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
      ))}

      <Separator orientation="vertical" className="mx-1 h-4" />

      <ToolbarButton label="Link" active={editor.isActive('link')} onClick={addLink}>
        <Link2 className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
    </div>
  )
}

export function RichTextEditor({
  name,
  defaultValue,
  placeholder = 'Write something…',
  minHeight = 'min-h-[120px]',
  onSubmit,
  className,
}: {
  /** Hidden input name the document JSON is posted under. */
  name: string
  defaultValue?: unknown
  placeholder?: string
  minHeight?: string
  /** Called on Cmd/Ctrl+Enter, for composers that submit inline. */
  onSubmit?: () => void
  className?: string
}) {
  const [json, setJson] = useState<string>(() =>
    defaultValue ? JSON.stringify(defaultValue) : '',
  )

  const editor = useEditor({
    // Rendering on the server would produce markup React then has to reconcile
    // against the editor's own DOM; Tiptap warns about exactly this.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // The editor posts JSON, so a horizontal rule adds a node the renderer
        // supports but the composer has no button for — keep the set tight.
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // Matches the renderer's allowlist, so what is authored is what renders.
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: (defaultValue as never) ?? '',
    editorProps: {
      attributes: {
        class: cn(
          'prose-none focus:outline-none px-3 py-2.5 text-sm leading-relaxed',
          '[&_p]:my-0 [&_ul]:list-disc [&_ol]:list-decimal [&_ul,&_ol]:ps-5 [&_li]:my-0.5',
          '[&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3',
          '[&_code]:rounded [&_code]:bg-surface-hover [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em]',
          '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
          '[&_.is-editor-empty:first-child::before]:pointer-events-none',
          '[&_.is-editor-empty:first-child::before]:float-start',
          '[&_.is-editor-empty:first-child::before]:h-0',
          '[&_.is-editor-empty:first-child::before]:text-faint',
          '[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          minHeight,
        ),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSubmit) {
          event.preventDefault()
          onSubmit()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: instance }) => {
      setJson(instance.isEmpty ? '' : JSON.stringify(instance.getJSON()))
    },
  })

  // Clearing the hidden input from outside (after a successful submit) has to
  // clear the editor too, or the composer keeps showing text that was already sent.
  useEffect(() => {
    if (json === '' && editor && !editor.isEmpty) editor.commands.clearContent()
  }, [json, editor])

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-input bg-surface-raised transition-colors focus-within:ring-2 focus-within:ring-ring/60',
        className,
      )}
    >
      {editor ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
      <input type="hidden" name={name} value={json} />
    </div>
  )
}

/** Imperative reset handle for composers that clear after submitting. */
export function useEditorReset() {
  const [nonce, setNonce] = useState(0)
  return { nonce, reset: () => setNonce((value) => value + 1) }
}
