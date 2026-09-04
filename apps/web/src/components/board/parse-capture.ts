import type { Priority } from '@pm/shared/constants'
import { addDays, format, nextDay, type Day } from 'date-fns'

export interface CaptureResult {
  title: string
  priority: Priority | null
  assigneeId: string | null
  assigneeName: string | null
  labelIds: string[]
  labelNames: string[]
  dueDate: string | null
  estimatedHours: number | null
}

/** `!urgent` reads better than `!critical` in a capture line; both are accepted. */
const PRIORITY_WORDS: Record<string, Priority> = {
  urgent: 'critical',
  critical: 'critical',
  high: 'high',
  med: 'medium',
  medium: 'medium',
  low: 'low',
}

const WEEKDAYS: Record<string, Day> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}

/**
 * Resolves a bare date word to an ISO date.
 *
 * Only forward-looking words are supported: a capture line saying "fri" means
 * the Friday that is coming, never the one that has passed, so a due date can
 * never be created already overdue.
 */
function resolveDateWord(word: string, today: Date): string | null {
  const key = word.toLowerCase()
  if (key === 'today') return format(today, 'yyyy-MM-dd')
  if (key === 'tomorrow' || key === 'tmrw') return format(addDays(today, 1), 'yyyy-MM-dd')

  const day = WEEKDAYS[key]
  if (day === undefined) return null
  return format(nextDay(today, day), 'yyyy-MM-dd')
}

/**
 * Parses the capture line's inline syntax.
 *
 * Tokens are matched against the project's real assignees and labels, so an
 * `@name` that matches nobody stays in the title rather than silently vanishing.
 */
export function parseCapture(
  input: string,
  options: {
    assignees: { id: string; full_name: string }[]
    labels: { id: string; name: string }[]
    today?: Date
  },
): CaptureResult {
  const today = options.today ?? new Date()

  const result: CaptureResult = {
    title: '',
    priority: null,
    assigneeId: null,
    assigneeName: null,
    labelIds: [],
    labelNames: [],
    dueDate: null,
    estimatedHours: null,
  }

  const kept: string[] = []
  const tokens = input.split(/\s+/)

  for (const token of tokens) {
    if (!token) continue
    const bare = token.slice(1).toLowerCase()

    if (token.startsWith('@') && bare) {
      const match = options.assignees.find((person) =>
        person.full_name.toLowerCase().replace(/\s+/g, '').startsWith(bare.replace(/\s+/g, '')),
      )
      if (match) {
        result.assigneeId = match.id
        result.assigneeName = match.full_name
        continue
      }
    }

    if (token.startsWith('#') && bare) {
      const match = options.labels.find((label) => label.name.toLowerCase() === bare)
      if (match) {
        result.labelIds.push(match.id)
        result.labelNames.push(match.name)
        continue
      }
    }

    if (token.startsWith('!') && PRIORITY_WORDS[bare]) {
      result.priority = PRIORITY_WORDS[bare]
      continue
    }

    if (token.startsWith('~')) {
      const hours = Number(token.slice(1))
      if (Number.isFinite(hours) && hours > 0 && hours <= 9999) {
        result.estimatedHours = hours
        continue
      }
    }

    // A date word only counts at the end of the line, so "fri" inside a
    // sentence ("ship fri deploy notes") stays part of the title.
    const isLast = tokens.indexOf(token) === tokens.length - 1
    if (isLast && !result.dueDate) {
      const date = resolveDateWord(token, today)
      if (date) {
        result.dueDate = date
        continue
      }
    }

    kept.push(token)
  }

  result.title = kept.join(' ').trim()
  return result
}

export interface CaptureHint {
  key: string
  text: string
  className: string
}

/** Chips shown to the right of the capture input, confirming what was understood. */
export function describeCapture(parsed: CaptureResult): CaptureHint[] {
  const hints: CaptureHint[] = []

  if (parsed.assigneeName) {
    hints.push({
      key: 'assignee',
      text: parsed.assigneeName.split(' ')[0] ?? parsed.assigneeName,
      className: 'bg-surface-hover text-muted-foreground',
    })
  }
  for (const name of parsed.labelNames) {
    hints.push({
      key: `label-${name}`,
      text: `#${name}`,
      className: 'bg-surface-hover text-muted-foreground',
    })
  }
  if (parsed.priority) {
    hints.push({
      key: 'priority',
      text: parsed.priority === 'critical' ? 'urgent' : parsed.priority,
      className:
        parsed.priority === 'critical'
          ? 'bg-priority-critical/15 text-priority-critical'
          : parsed.priority === 'high'
            ? 'bg-priority-high/15 text-priority-high'
            : 'bg-surface-hover text-muted-foreground',
    })
  }
  if (parsed.estimatedHours !== null) {
    hints.push({
      key: 'points',
      text: `${parsed.estimatedHours}h`,
      className: 'bg-surface-hover text-muted-foreground',
    })
  }
  if (parsed.dueDate) {
    hints.push({
      key: 'due',
      text: parsed.dueDate.slice(5),
      className: 'bg-surface-hover text-muted-foreground',
    })
  }

  return hints
}
