import { PRIORITIES, type KanbanSwimlaneBy, type Priority } from '@pm/shared/constants'
import { PRIORITY_STRIPE } from '@/components/tasks/task-badges'
import type { KanbanCardData } from './types'

export interface Swimlane {
  key: string
  /** Empty when swimlanes are off — the lane then renders without a header. */
  label: string
  color: string
  cards: KanbanCardData[]
}

const PRIORITY_LANE_LABEL: Record<Priority, string> = {
  critical: 'URGENT',
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
}

/**
 * Split a column's cards into horizontal lanes (§19.8).
 *
 * With swimlanes off this returns a single unlabelled lane, so the column body
 * renders through the same path either way and never has to branch on it.
 *
 * Empty lanes are dropped rather than shown as headers over nothing: a column
 * grouped by status and laned by priority would otherwise carry four captions
 * for one card.
 */
export function swimlanesFor(cards: KanbanCardData[], swimlaneBy: KanbanSwimlaneBy): Swimlane[] {
  if (swimlaneBy === 'none' || swimlaneBy === 'custom_field') {
    return [{ key: 'all', label: '', color: 'transparent', cards }]
  }

  if (swimlaneBy === 'priority') {
    return PRIORITIES.map((priority) => ({
      key: priority,
      label: PRIORITY_LANE_LABEL[priority],
      color: PRIORITY_STRIPE[priority],
      cards: cards.filter((card) => card.priority === priority),
    })).filter((lane) => lane.cards.length > 0)
  }

  if (swimlaneBy === 'assignee') {
    const lanes = new Map<string, Swimlane>()
    for (const card of cards) {
      const key = card.assignee?.id ?? 'unassigned'
      if (!lanes.has(key)) {
        lanes.set(key, {
          key,
          label: (card.assignee?.full_name ?? 'Unassigned').toUpperCase(),
          color: card.assignee ? 'hsl(var(--primary))' : 'hsl(var(--subtle))',
          cards: [],
        })
      }
      lanes.get(key)!.cards.push(card)
    }
    return [...lanes.values()]
  }

  // Label: a task can carry several, so the lane is its first — the same rule
  // the label GROUPING uses, keeping a card in exactly one lane.
  const lanes = new Map<string, Swimlane>()
  for (const card of cards) {
    const label = card.labels[0]
    const key = label?.id ?? 'unlabelled'
    if (!lanes.has(key)) {
      lanes.set(key, {
        key,
        label: (label?.name ?? 'Unlabelled').toUpperCase(),
        color: label?.color ?? 'hsl(var(--subtle))',
        cards: [],
      })
    }
    lanes.get(key)!.cards.push(card)
  }
  return [...lanes.values()]
}
