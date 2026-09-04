import { describe, expect, it } from 'vitest'
import { parseCapture } from '../parse-capture'

const OPTIONS = {
  assignees: [
    { id: 'u-jonas', full_name: 'Jonas Lind' },
    { id: 'u-riya', full_name: 'Riya Menon' },
  ],
  labels: [
    { id: 'l-infra', name: 'infra' },
    { id: 'l-bug', name: 'bug' },
  ],
  // A Wednesday, so "fri" is two days out and "mon" wraps into next week.
  today: new Date('2026-09-02T12:00:00Z'),
}

describe('parseCapture', () => {
  it('pulls every token out of the title', () => {
    const result = parseCapture('Ship read-only banner @jonas #infra !high ~3 fri', OPTIONS)

    expect(result.title).toBe('Ship read-only banner')
    expect(result.assigneeId).toBe('u-jonas')
    expect(result.labelIds).toEqual(['l-infra'])
    expect(result.priority).toBe('high')
    expect(result.estimatedHours).toBe(3)
    expect(result.dueDate).toBe('2026-09-04')
  })

  it('maps !urgent onto the critical priority the database stores', () => {
    expect(parseCapture('Fix login !urgent', OPTIONS).priority).toBe('critical')
  })

  it('keeps an unmatched mention in the title rather than dropping it', () => {
    const result = parseCapture('Ping @nobody about #nothing', OPTIONS)

    expect(result.title).toBe('Ping @nobody about #nothing')
    expect(result.assigneeId).toBeNull()
    expect(result.labelIds).toEqual([])
  })

  it('only reads a date word at the end of the line', () => {
    const mid = parseCapture('Ship fri deploy notes', OPTIONS)
    expect(mid.dueDate).toBeNull()
    expect(mid.title).toBe('Ship fri deploy notes')

    const end = parseCapture('Ship deploy notes fri', OPTIONS)
    expect(end.dueDate).toBe('2026-09-04')
    expect(end.title).toBe('Ship deploy notes')
  })

  it('resolves a weekday forwards, never into the past', () => {
    // Wednesday → the coming Monday, not the one just gone.
    expect(parseCapture('Draft plan mon', OPTIONS).dueDate).toBe('2026-09-07')
    expect(parseCapture('Draft plan today', OPTIONS).dueDate).toBe('2026-09-02')
    expect(parseCapture('Draft plan tomorrow', OPTIONS).dueDate).toBe('2026-09-03')
  })

  it('ignores a malformed estimate instead of storing NaN', () => {
    const result = parseCapture('Rework onboarding ~abc', OPTIONS)
    expect(result.estimatedHours).toBeNull()
    expect(result.title).toBe('Rework onboarding ~abc')
  })
})
