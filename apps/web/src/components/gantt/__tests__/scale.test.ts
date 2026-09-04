import { describe, expect, it } from 'vitest'
import { chartRange, dayOffset, monthBands, parseDate, ticksFor, toDateString } from '../scale'

describe('parseDate', () => {
  it('reads a yyyy-MM-dd string as a local calendar date', () => {
    const date = parseDate('2026-03-09')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(2)
    expect(date.getDate()).toBe(9)
  })

  it('round-trips through toDateString without drifting a day', () => {
    // new Date('2026-01-01') parses as UTC midnight, which is the previous day
    // in any negative offset. This is the bug the helper exists to avoid.
    for (const value of ['2026-01-01', '2026-06-30', '2026-12-31']) {
      expect(toDateString(parseDate(value))).toBe(value)
    }
  })
})

describe('dayOffset', () => {
  it('counts calendar days from the range start', () => {
    const start = parseDate('2026-03-01')
    expect(dayOffset(start, '2026-03-01')).toBe(0)
    expect(dayOffset(start, '2026-03-08')).toBe(7)
    expect(dayOffset(start, '2026-02-27')).toBe(-2)
  })

  it('is unaffected by a DST boundary', () => {
    // US DST begins 2026-03-08; a naive hours-based diff loses an hour here and
    // rounds to the wrong day.
    const start = parseDate('2026-03-06')
    expect(dayOffset(start, '2026-03-10')).toBe(4)
  })
})

describe('chartRange', () => {
  it('pads before the first date so a bar never sits on the edge', () => {
    const { start } = chartRange(['2026-03-10', '2026-03-20'], '2026-03-15')
    expect(toDateString(start)).toBe('2026-03-07')
  })

  it('always covers today, even when every task is in the past', () => {
    const { start, days } = chartRange(['2026-01-05'], '2026-03-15')
    expect(dayOffset(start, '2026-03-15')).toBeLessThan(days)
    expect(dayOffset(start, '2026-03-15')).toBeGreaterThanOrEqual(0)
  })

  it('enforces a minimum width so a single-day project still renders', () => {
    const { days } = chartRange(['2026-03-10'], '2026-03-10')
    expect(days).toBeGreaterThanOrEqual(30)
  })

  it('handles an empty task list by anchoring on today', () => {
    const { start, days } = chartRange([], '2026-03-15')
    expect(days).toBe(30)
    // Today is the only known date, so it gets the same leading pad as a task.
    expect(dayOffset(start, '2026-03-15')).toBe(3)
  })
})

describe('ticksFor', () => {
  it('marks Mondays as major at day zoom', () => {
    // 2026-03-02 is a Monday.
    const ticks = ticksFor(parseDate('2026-03-01'), 9, 'day')
    expect(ticks).toHaveLength(9)
    expect(ticks[1]?.major).toBe(true)
    expect(ticks[2]?.major).toBe(false)
  })

  it('never emits a tick before the range start', () => {
    for (const zoom of ['day', 'week', 'month'] as const) {
      const ticks = ticksFor(parseDate('2026-03-05'), 40, zoom)
      expect(ticks.every((tick) => tick.offset >= 0)).toBe(true)
    }
  })

  it('keeps every tick inside the range', () => {
    const days = 40
    for (const zoom of ['day', 'week', 'month'] as const) {
      const ticks = ticksFor(parseDate('2026-03-05'), days, zoom)
      expect(ticks.every((tick) => tick.offset < days)).toBe(true)
    }
  })
})

describe('monthBands', () => {
  it('tiles the range with no gaps or overlaps', () => {
    const days = 70
    const bands = monthBands(parseDate('2026-03-15'), days)

    expect(bands[0]?.offset).toBe(0)
    let cursor = 0
    for (const band of bands) {
      expect(band.offset).toBe(cursor)
      expect(band.span).toBeGreaterThan(0)
      cursor += band.span
    }
    expect(cursor).toBe(days)
  })

  it('labels the first band with the month the range starts in', () => {
    const bands = monthBands(parseDate('2026-03-15'), 40)
    expect(bands[0]?.label).toBe('March 2026')
  })
})
