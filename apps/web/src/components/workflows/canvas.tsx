'use client'

import {
  VALID_NEXT_NODES,
  WORKFLOW_ACTION_LABELS,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_NODE_LABELS,
  validateGraph,
  type GraphProblem,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeType,
} from '@pm/shared/constants'
import { Button, cn } from '@pm/ui'
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

const NODE_WIDTH = 196
const NODE_HEIGHT = 60
const GRID = 8

/**
 * The glyph on each node's icon tile.
 *
 * The design gives every node type a geometric mark rather than a drawn icon,
 * so the canvas reads in the same voice as the sidebar and the board.
 */
const NODE_GLYPH: Record<WorkflowNodeType, string> = {
  trigger: '⚡',
  condition: '⋔',
  filter: '⊽',
  delay: '◔',
  branch: '⑂',
  action: '＋',
}

const NODE_ACCENT: Record<WorkflowNodeType, string> = {
  trigger: 'hsl(var(--status-progress))',
  condition: 'hsl(var(--status-review))',
  filter: 'hsl(var(--status-review))',
  delay: 'hsl(var(--priority-high))',
  branch: 'hsl(var(--status-done))',
  action: 'hsl(var(--brand))',
}

/**
 * Workflow canvas.
 *
 * Hand-built rather than react-flow: the graph is small, the interactions are
 * drag, connect and select, and the library would bring its own theme to fight
 * with the design tokens. Nodes are absolutely positioned; edges are one SVG
 * layer underneath.
 *
 * The canvas is the source of truth for layout only. Validity is decided by
 * `validateGraph` from @pm/shared, the same function the server runs on save —
 * so what the editor marks red is exactly what the server will refuse.
 */
export function WorkflowCanvas({
  graph,
  onChange,
  readOnly = false,
}: {
  graph: WorkflowGraph
  onChange: (next: WorkflowGraph) => void
  readOnly?: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null)

  const problems = useMemo(() => validateGraph(graph), [graph])
  const problemsByNode = useMemo(() => {
    const map = new Map<string, GraphProblem[]>()
    for (const problem of problems) {
      if (!problem.at) continue
      map.set(problem.at, [...(map.get(problem.at) ?? []), problem])
    }
    return map
  }, [problems])

  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null

  const addNode = useCallback(
    (type: WorkflowNodeType) => {
      const id = `n${Date.now().toString(36)}`
      // Stack new nodes down the left so they never land on top of each other.
      const y = graph.nodes.length * (NODE_HEIGHT + 24) + 24
      onChange({
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            id,
            type,
            ...(type === 'action' ? { action_type: 'add_label' as const } : {}),
            config: type === 'delay' ? { duration: '1h' } : {},
            position: { x: 24, y },
          },
        ],
      })
      setSelectedId(id)
    },
    [graph, onChange],
  )

  const removeNode = useCallback(
    (id: string) => {
      onChange({
        nodes: graph.nodes.filter((node) => node.id !== id),
        // Edges to a removed node would dangle; parseGraph drops them anyway,
        // but leaving them would make the canvas briefly lie.
        edges: graph.edges.filter((edge) => edge.source !== id && edge.target !== id),
      })
      setSelectedId(null)
    },
    [graph, onChange],
  )

  const connect = useCallback(
    (targetId: string) => {
      const sourceId = connectingFrom
      setConnectingFrom(null)
      if (!sourceId || sourceId === targetId) return

      const exists = graph.edges.some(
        (edge) => edge.source === sourceId && edge.target === targetId,
      )
      if (exists) return

      const source = graph.nodes.find((node) => node.id === sourceId)
      const label =
        source?.type === 'condition'
          ? graph.edges.filter((edge) => edge.source === sourceId).length === 0
            ? 'yes'
            : 'no'
          : undefined

      onChange({
        ...graph,
        edges: [
          ...graph.edges,
          { id: `${sourceId}->${targetId}`, source: sourceId, target: targetId, ...(label ? { label } : {}) },
        ],
      })
    },
    [connectingFrom, graph, onChange],
  )

  function startDrag(event: React.PointerEvent, node: WorkflowNode) {
    if (readOnly || connectingFrom) return
    const surface = surfaceRef.current?.getBoundingClientRect()
    if (!surface) return
    ;(event.target as Element).setPointerCapture(event.pointerId)
    dragRef.current = {
      id: node.id,
      offsetX: event.clientX - surface.left - node.position.x,
      offsetY: event.clientY - surface.top - node.position.y,
    }
    setSelectedId(node.id)
  }

  function onDrag(event: React.PointerEvent) {
    const drag = dragRef.current
    const surface = surfaceRef.current?.getBoundingClientRect()
    if (!drag || !surface) return

    // Snap to the grid so a hand-built graph still lines up.
    const x = Math.max(0, Math.round((event.clientX - surface.left - drag.offsetX) / GRID) * GRID)
    const y = Math.max(0, Math.round((event.clientY - surface.top - drag.offsetY) / GRID) * GRID)

    onChange({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === drag.id ? { ...node, position: { x, y } } : node,
      ),
    })
  }

  const height = Math.max(
    360,
    ...graph.nodes.map((node) => node.position.y + NODE_HEIGHT + 40),
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-3">
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(WORKFLOW_NODE_LABELS) as WorkflowNodeType[])
              // Exactly one trigger, added when the workflow is created.
              .filter((type) => type !== 'trigger')
              .map((type) => (
                <Button key={type} variant="subtle" size="xs" onClick={() => addNode(type)}>
                  <Plus className="h-3 w-3" aria-hidden />
                  {WORKFLOW_NODE_LABELS[type]}
                </Button>
              ))}

            {connectingFrom ? (
              <span className="label-meta ms-auto flex items-center gap-2 rounded bg-primary/10 px-2 py-1 text-primary">
                Click a node to connect
                <button type="button" onClick={() => setConnectingFrom(null)} aria-label="Cancel">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ) : null}
          </div>
        )}

        <div
          ref={surfaceRef}
          onPointerMove={onDrag}
          onPointerUp={() => {
            dragRef.current = null
          }}
          onPointerLeave={() => {
            dragRef.current = null
          }}
          className="border-border bg-sunk relative overflow-auto rounded-[11px] border [background-image:radial-gradient(hsl(var(--input))_1px,transparent_1px)] [background-size:18px_18px]"
          style={{ height }}
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              <marker
                id="wf-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 1 L 7 4 L 0 7 z" fill="hsl(var(--faint))" />
              </marker>
            </defs>

            {graph.edges.map((edge) => {
              const from = graph.nodes.find((node) => node.id === edge.source)
              const to = graph.nodes.find((node) => node.id === edge.target)
              if (!from || !to) return null

              const x1 = from.position.x + NODE_WIDTH
              const y1 = from.position.y + NODE_HEIGHT / 2
              const x2 = to.position.x
              const y2 = to.position.y + NODE_HEIGHT / 2
              const mid = x2 - 12 > x1 + 12 ? (x1 + x2) / 2 : x1 + 24

              const bad = problems.some((problem) => problem.at === edge.id)

              return (
                <g key={edge.id}>
                  <path
                    d={`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`}
                    fill="none"
                    stroke={bad ? 'hsl(var(--destructive))' : 'hsl(var(--faint))'}
                    strokeWidth="1.5"
                    strokeDasharray={bad ? '4 3' : undefined}
                    markerEnd="url(#wf-arrow)"
                  />
                  {edge.label ? (
                    <text
                      x={mid}
                      y={(y1 + y2) / 2 - 4}
                      textAnchor="middle"
                      className="fill-faint text-[9px] uppercase"
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>

          {graph.nodes.map((node) => {
            const nodeProblems = problemsByNode.get(node.id) ?? []
            const isSource = connectingFrom === node.id
            const canReceive =
              connectingFrom !== null &&
              !isSource &&
              node.type !== 'trigger' &&
              VALID_NEXT_NODES[
                graph.nodes.find((n) => n.id === connectingFrom)?.type ?? 'action'
              ].includes(node.type)

            return (
              <div
                key={node.id}
                onPointerDown={(event) => startDrag(event, node)}
                onClick={() => (connectingFrom ? connect(node.id) : setSelectedId(node.id))}
                className={cn(
                  'bg-card absolute flex cursor-grab items-center gap-[11px] rounded-[11px] border-[1.5px] px-[13px] py-3 transition-[border-color,box-shadow] active:cursor-grabbing',
                  selectedId === node.id ? 'border-primary shadow-raised' : 'border-border',
                  nodeProblems.length > 0 && 'border-destructive',
                  canReceive && 'ring-primary/50 ring-2',
                  isSource && 'opacity-60',
                )}
                style={{
                  insetInlineStart: node.position.x,
                  top: node.position.y,
                  width: NODE_WIDTH,
                  height: NODE_HEIGHT,
                }}
              >
                {/* The type is carried by a tinted tile rather than an edge
                    stripe: at 196px the stripe read as a border artefact. */}
                <span
                  aria-hidden
                  className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] font-glyph text-[15px]"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${NODE_ACCENT[node.type]} 16%, transparent)`,
                    color: NODE_ACCENT[node.type],
                  }}
                >
                  {NODE_GLYPH[node.type]}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-ui font-semibold">
                    {node.type === 'action' && node.action_type
                      ? WORKFLOW_ACTION_LABELS[node.action_type]
                      : node.type === 'delay'
                        ? `Wait ${String(node.config.duration ?? '?')}`
                        : WORKFLOW_NODE_LABELS[node.type]}
                  </span>
                  <span className="text-faint truncate text-[10.5px]">
                    {WORKFLOW_NODE_LABELS[node.type]}
                  </span>
                </span>

                {nodeProblems.length > 0 ? (
                  <AlertTriangle
                    className="text-destructive absolute end-2 top-2 h-3 w-3"
                    aria-label={nodeProblems[0]!.message}
                  />
                ) : null}

                {!readOnly && !connectingFrom ? (
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      setConnectingFrom(node.id)
                    }}
                    aria-label={`Connect from ${WORKFLOW_NODE_LABELS[node.type]}`}
                    className="absolute -end-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-border bg-surface-overlay text-[10px] leading-none text-faint transition-colors hover:border-primary hover:text-primary"
                  >
                    +
                  </button>
                ) : null}
              </div>
            )
          })}

          {graph.nodes.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center text-base text-faint">
              Add a node to begin.
            </p>
          ) : null}
        </div>

        {problems.length > 0 ? (
          <ul className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
            {problems.map((problem, index) => (
              <li
                // Problems have no stable id of their own.
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                className="text-base text-destructive"
              >
                {problem.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="label-meta text-success">Graph is valid</p>
        )}
      </div>

      <NodeInspector
        node={selected}
        graph={graph}
        onChange={onChange}
        onDelete={removeNode}
        readOnly={readOnly}
      />
    </div>
  )
}

/** Right-hand panel for the selected node. */
function NodeInspector({
  node,
  graph,
  onChange,
  onDelete,
  readOnly,
}: {
  node: WorkflowNode | null
  graph: WorkflowGraph
  onChange: (next: WorkflowGraph) => void
  onDelete: (id: string) => void
  readOnly: boolean
}) {
  if (!node) {
    return (
      <aside className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <p className="label-meta text-faint">Inspector</p>
        <p className="pt-2 text-base text-muted-foreground">
          Select a node to configure it.
        </p>
      </aside>
    )
  }

  const patch = (changes: Partial<WorkflowNode>) =>
    onChange({
      ...graph,
      nodes: graph.nodes.map((entry) =>
        entry.id === node.id ? { ...entry, ...changes } : entry,
      ),
    })

  const inputClass =
    'flex h-9 w-full rounded-md border border-input bg-card px-3 text-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

  return (
    <aside className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2">
        <p className="label-meta flex-1 text-faint">{WORKFLOW_NODE_LABELS[node.type]}</p>
        {!readOnly && node.type !== 'trigger' ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete node"
            onClick={() => onDelete(node.id)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>

      {node.type === 'action' ? (
        <label className="block space-y-1.5">
          <span className="label-meta text-faint">Action</span>
          <select
            value={node.action_type ?? 'add_label'}
            disabled={readOnly}
            onChange={(event) =>
              patch({ action_type: event.target.value as WorkflowNode['action_type'] })
            }
            className={inputClass}
          >
            {WORKFLOW_ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {WORKFLOW_ACTION_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {node.type === 'delay' ? (
        <label className="block space-y-1.5">
          <span className="label-meta text-faint">Wait for</span>
          <select
            value={String(node.config.duration ?? '1h')}
            disabled={readOnly}
            onChange={(event) => patch({ config: { ...node.config, duration: event.target.value } })}
            className={inputClass}
          >
            {['15m', '1h', '4h', '1d', '3d', '1w'].map((duration) => (
              <option key={duration} value={duration}>
                {duration}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {node.type === 'condition' || node.type === 'filter' ? (
        <label className="block space-y-1.5">
          <span className="label-meta text-faint">When field</span>
          <input
            value={String(node.config.field ?? '')}
            disabled={readOnly}
            placeholder="status"
            onChange={(event) => patch({ config: { ...node.config, field: event.target.value } })}
            className={inputClass}
          />
          <span className="label-meta text-faint">Equals</span>
          <input
            value={String(node.config.equals ?? '')}
            disabled={readOnly}
            placeholder="done"
            onChange={(event) => patch({ config: { ...node.config, equals: event.target.value } })}
            className={inputClass}
          />
        </label>
      ) : null}

      <p className="border-t border-border-subtle pt-3 text-nav text-faint">
        {graph.edges.filter((edge) => edge.source === node.id).length} outgoing ·{' '}
        {graph.edges.filter((edge) => edge.target === node.id).length} incoming
      </p>
    </aside>
  )
}
