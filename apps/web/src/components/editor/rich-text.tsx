import { cn } from '@pm/ui'
import type { ReactNode } from 'react'

/**
 * Renders a Tiptap document as React elements.
 *
 * Deliberately NOT `dangerouslySetInnerHTML`: bodies are sanitized before
 * storage (§13.1), and rendering through React escapes text as a second,
 * independent layer. An unknown node type is skipped rather than rendered raw,
 * so a document written by a future editor version can never inject markup.
 */

interface Mark {
  type: string
  attrs?: Record<string, unknown>
}

interface Node {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: Mark[]
  content?: Node[]
}

/** Only these protocols may appear in a link. Everything else is dropped. */
function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  try {
    const url = new URL(href, 'https://example.invalid')
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
      ? href
      : null
  } catch {
    return null
  }
}

function applyMarks(text: string, marks: Mark[] | undefined, key: string): ReactNode {
  if (!marks?.length) return text

  return marks.reduce<ReactNode>((node, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong key={key}>{node}</strong>
      case 'italic':
        return <em key={key}>{node}</em>
      case 'strike':
        return <s key={key}>{node}</s>
      case 'code':
        return (
          <code key={key} className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.9em]">
            {node}
          </code>
        )
      case 'link': {
        const href = safeHref(mark.attrs?.href)
        if (!href) return node
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            // noopener stops the opened page reaching back through window.opener.
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {node}
          </a>
        )
      }
      default:
        return node
    }
  }, text)
}

function renderNodes(nodes: Node[] | undefined, keyPrefix: string): ReactNode[] {
  if (!nodes) return []

  return nodes.flatMap<ReactNode>((node, index): ReactNode[] => {
    const key = `${keyPrefix}-${index}`

    if (node.type === 'text') {
      return [<span key={key}>{applyMarks(node.text ?? '', node.marks, key)}</span>]
    }

    switch (node.type) {
      case 'paragraph':
        return [
          <p key={key} className="whitespace-pre-wrap break-words">
            {renderNodes(node.content, key)}
          </p>,
        ]
      case 'heading': {
        const level = Number(node.attrs?.level ?? 2)
        const sizes: Record<number, string> = {
          1: 'text-head font-semibold',
          2: 'text-base font-semibold',
          3: 'text-ui font-semibold',
        }
        const Tag = (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3'
        return [
          <Tag key={key} className={cn('pt-2', sizes[level] ?? sizes[3])}>
            {renderNodes(node.content, key)}
          </Tag>,
        ]
      }
      case 'bulletList':
        return [
          <ul key={key} className="list-disc space-y-1 ps-5">
            {renderNodes(node.content, key)}
          </ul>,
        ]
      case 'orderedList':
        return [
          <ol key={key} className="list-decimal space-y-1 ps-5">
            {renderNodes(node.content, key)}
          </ol>,
        ]
      case 'listItem':
        return [<li key={key}>{renderNodes(node.content, key)}</li>]
      case 'blockquote':
        return [
          <blockquote key={key} className="border-s-2 border-border ps-3 text-muted-foreground">
            {renderNodes(node.content, key)}
          </blockquote>,
        ]
      case 'codeBlock':
        return [
          <pre
            key={key}
            className="scrollbar-slim overflow-x-auto rounded-md bg-card p-3 font-mono text-nav"
          >
            <code>{renderNodes(node.content, key)}</code>
          </pre>,
        ]
      case 'hardBreak':
        return [<br key={key} />]
      case 'horizontalRule':
        return [<hr key={key} className="border-border-subtle" />]
      default:
        // Unknown block: render its children rather than dropping the text, but
        // never the node itself.
        return node.content ? renderNodes(node.content, key) : []
    }
  })
}

/** True when the document has no renderable text — used to show an empty state. */
export function isEmptyDoc(doc: unknown): boolean {
  const text = JSON.stringify(doc ?? {}).match(/"text":"(.*?)"/g)
  return !text || text.every((match) => match === '"text":""')
}

export function RichTextView({ doc, className }: { doc: unknown; className?: string }) {
  const root = doc as Node | null
  if (!root?.content?.length) return null

  return (
    <div className={cn('space-y-2 text-ui leading-relaxed', className)}>
      {renderNodes(root.content, 'n')}
    </div>
  )
}
