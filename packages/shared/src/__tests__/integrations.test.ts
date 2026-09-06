import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTEGRATION_EVENTS,
  INTEGRATION_SUBSCRIBABLE_EVENTS,
  describeEvent,
  parseSlackConfig,
  subjectLabel,
} from '../constants/integrations'

describe('INTEGRATION_SUBSCRIBABLE_EVENTS', () => {
  it('excludes billing events', () => {
    // Routing these to a team channel would show everyone in it what the
    // company pays.
    for (const event of INTEGRATION_SUBSCRIBABLE_EVENTS) {
      expect(event.startsWith('subscription.')).toBe(false)
      expect(event.startsWith('payment.')).toBe(false)
    }
  })

  it('still includes the work events', () => {
    expect(INTEGRATION_SUBSCRIBABLE_EVENTS).toContain('task.created')
    expect(INTEGRATION_SUBSCRIBABLE_EVENTS).toContain('comment.created')
  })

  it('defaults are all subscribable', () => {
    for (const event of DEFAULT_INTEGRATION_EVENTS) {
      expect(INTEGRATION_SUBSCRIBABLE_EVENTS).toContain(event)
    }
  })
})

describe('parseSlackConfig', () => {
  it('falls back to the default subscription for a new connection', () => {
    expect(parseSlackConfig(null).events).toEqual([...DEFAULT_INTEGRATION_EVENTS])
    expect(parseSlackConfig({}).channelId).toBeNull()
  })

  it('keeps recognised values', () => {
    const config = parseSlackConfig({
      teamId: 'T123',
      teamName: 'Acme',
      channelId: 'C456',
      channelName: 'general',
      events: ['task.created'],
    })
    expect(config).toEqual({
      teamId: 'T123',
      teamName: 'Acme',
      channelId: 'C456',
      channelName: 'general',
      events: ['task.created'],
    })
  })

  it('drops events that are not subscribable, including billing ones', () => {
    const config = parseSlackConfig({
      events: ['task.created', 'payment.succeeded', 'not.a.real.event', 42],
    })
    expect(config.events).toEqual(['task.created'])
  })

  it('accepts an explicitly empty subscription', () => {
    // Subscribing to nothing is a legitimate way to mute an integration
    // without disconnecting it, and must not silently revert to the defaults.
    expect(parseSlackConfig({ events: [] }).events).toEqual([])
  })

  it('ignores non-string identifiers rather than coercing them', () => {
    expect(parseSlackConfig({ channelId: 12345 }).channelId).toBeNull()
  })
})

describe('subjectLabel', () => {
  it('finds the most useful title a row offers', () => {
    expect(subjectLabel({ new: { title: 'Ship the thing' } })).toBe('Ship the thing')
    expect(subjectLabel({ new: { name: 'Apollo' } })).toBe('Apollo')
    expect(subjectLabel({ new: { doc_number: 'INV-0001' } })).toBe('INV-0001')
  })

  it('prefers title over the other candidates', () => {
    expect(subjectLabel({ new: { name: 'Project', title: 'Task' } })).toBe('Task')
  })

  it('falls back to the old row on a delete', () => {
    expect(subjectLabel({ old: { title: 'Removed' } })).toBe('Removed')
  })

  it('returns null rather than inventing a label', () => {
    expect(subjectLabel({})).toBeNull()
    expect(subjectLabel({ new: {} })).toBeNull()
    expect(subjectLabel({ new: { title: '   ' } })).toBeNull()
    expect(subjectLabel({ new: null })).toBeNull()
  })

  it('caps a very long title', () => {
    expect(subjectLabel({ new: { title: 'x'.repeat(500) } })).toHaveLength(120)
  })
})

describe('describeEvent', () => {
  it('reads as a sentence', () => {
    expect(
      describeEvent({
        eventType: 'task.created',
        payload: { new: { title: 'Ship the thing' } },
        actorName: 'Ada',
      }),
    ).toBe('Ada created task "Ship the thing"')
  })

  it('says "Someone" when there is no actor, rather than leaving a gap', () => {
    expect(describeEvent({ eventType: 'task.created', payload: { new: { title: 'X' } } })).toBe(
      'Someone created task "X"',
    )
    expect(
      describeEvent({ eventType: 'task.created', payload: {}, actorName: '  ' }),
    ).toBe('Someone created a task')
  })

  it('drops the quoted subject when the row has no usable title', () => {
    expect(describeEvent({ eventType: 'member.joined', payload: {}, actorName: 'Ada' })).toBe(
      'Ada joined a member',
    )
  })

  it('spells out a status change, which the verb alone does not convey', () => {
    expect(
      describeEvent({
        eventType: 'task.updated',
        payload: {
          new: { title: 'Ship it' },
          changes: { status: { old: 'todo', new: 'in_progress' } },
        },
        actorName: 'Ada',
      }),
    ).toBe('Ada updated task "Ship it": todo → in_progress')
  })

  it('handles a status change with a missing side', () => {
    expect(
      describeEvent({
        eventType: 'task.updated',
        payload: { new: { title: 'X' }, changes: { status: { new: 'done' } } },
        actorName: 'Ada',
      }),
    ).toBe('Ada updated task "X": — → done')
  })

  it('ignores non-status changes and keeps the plain sentence', () => {
    expect(
      describeEvent({
        eventType: 'task.updated',
        payload: { new: { title: 'X' }, changes: { priority: { old: 'low', new: 'high' } } },
        actorName: 'Ada',
      }),
    ).toBe('Ada updated task "X"')
  })

  it('renders a commercial document as a document', () => {
    expect(
      describeEvent({
        eventType: 'commercial_document.updated',
        payload: { new: { doc_number: 'QUO-0007' } },
        actorName: 'Ada',
      }),
    ).toBe('Ada updated document "QUO-0007"')
  })

  it('degrades gracefully for an event type it has no words for', () => {
    // A new event type must produce a readable line, not a crash or "undefined".
    const text = describeEvent({
      eventType: 'widget.frobnicated',
      payload: {},
      actorName: 'Ada',
    })
    expect(text).toBe('Ada frobnicated a widget')
  })

  it('does not throw on a malformed event type', () => {
    expect(() => describeEvent({ eventType: '', payload: {} })).not.toThrow()
  })
})
