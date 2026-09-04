import { describe, expect, it } from 'vitest'
import {
  describeSchedule,
  isDue,
  parseSchedule,
  scheduleToCron,
  slotKey,
  zonedParts,
  type WorkflowSchedule,
} from '../constants/workflow-schedule'

const daily = (over: Partial<WorkflowSchedule> = {}): WorkflowSchedule => ({
  frequency: 'daily',
  hour: 9,
  minute: 0,
  weekday: 1,
  day: 1,
  ...over,
})

describe('parseSchedule', () => {
  it('falls back to the default for junk', () => {
    expect(parseSchedule(null)).toEqual(parseSchedule({}))
    expect(parseSchedule({ frequency: 'fortnightly' }).frequency).toBe('daily')
  })

  it('clamps rather than rejecting out-of-range values', () => {
    const s = parseSchedule({ frequency: 'daily', hour: 99, minute: -5 })
    expect(s.hour).toBe(23)
    expect(s.minute).toBe(0)
  })

  it('caps the day of month at 28', () => {
    // 29-31 do not exist in every month. Capping runs slightly early in long
    // months; not capping skips February entirely.
    expect(parseSchedule({ frequency: 'monthly', day: 31 }).day).toBe(28)
  })

  it('accepts numeric strings from a form', () => {
    expect(parseSchedule({ frequency: 'daily', hour: '14', minute: '30' })).toMatchObject({
      hour: 14,
      minute: 30,
    })
  })
})

describe('scheduleToCron', () => {
  it('maps each frequency to its cron equivalent', () => {
    expect(scheduleToCron(daily({ frequency: 'hourly', minute: 15 }))).toBe('15 * * * *')
    expect(scheduleToCron(daily({ hour: 9, minute: 0 }))).toBe('0 9 * * *')
    expect(scheduleToCron(daily({ frequency: 'weekly', hour: 8, minute: 5, weekday: 3 }))).toBe('5 8 * * 3')
    expect(scheduleToCron(daily({ frequency: 'monthly', hour: 7, minute: 0, day: 12 }))).toBe('0 7 12 * *')
  })
})

describe('zonedParts', () => {
  it('reads wall-clock fields in the target zone, not UTC', () => {
    // 2024-06-01T02:00Z is still 31 May in New York.
    const p = zonedParts(new Date('2024-06-01T02:00:00Z'), 'America/New_York')
    expect(p).toMatchObject({ year: 2024, month: 5, day: 31, hour: 22 })
  })

  it('reports midnight as hour 0, not 24', () => {
    expect(zonedParts(new Date('2024-06-01T00:00:00Z'), 'UTC').hour).toBe(0)
  })

  it('falls back to UTC for an unknown zone instead of throwing', () => {
    const p = zonedParts(new Date('2024-06-01T05:00:00Z'), 'Mars/Olympus')
    expect(p.hour).toBe(5)
  })
})

describe('isDue', () => {
  const tz = 'America/New_York'

  it('does not fire before the scheduled time', () => {
    // 12:00Z = 08:00 New York, schedule is 09:00.
    expect(isDue(daily(), new Date('2024-06-03T12:00:00Z'), null, tz)).toBe(false)
  })

  it('fires once the time is reached', () => {
    expect(isDue(daily(), new Date('2024-06-03T13:05:00Z'), null, tz)).toBe(true)
  })

  it('does not fire twice in the same slot', () => {
    const first = new Date('2024-06-03T13:05:00Z')
    const later = new Date('2024-06-03T18:00:00Z')
    expect(isDue(daily(), later, first, tz)).toBe(false)
  })

  it('fires again the next day', () => {
    const yesterday = new Date('2024-06-03T13:05:00Z')
    const today = new Date('2024-06-04T13:05:00Z')
    expect(isDue(daily(), today, yesterday, tz)).toBe(true)
  })

  it('uses the org timezone, so the same instant differs by zone', () => {
    // 08:30Z is 04:30 in New York (too early) but 09:30 in London (due).
    const at = new Date('2024-06-03T08:30:00Z')
    expect(isDue(daily(), at, null, 'America/New_York')).toBe(false)
    expect(isDue(daily(), at, null, 'Europe/London')).toBe(true)
  })

  it('holds a weekly schedule to its weekday', () => {
    const monday = new Date('2024-06-03T13:05:00Z')
    const tuesday = new Date('2024-06-04T13:05:00Z')
    const weekly = daily({ frequency: 'weekly', weekday: 1 })
    expect(isDue(weekly, monday, null, tz)).toBe(true)
    expect(isDue(weekly, tuesday, null, tz)).toBe(false)
  })

  it('holds a monthly schedule to its day', () => {
    const monthly = daily({ frequency: 'monthly', day: 15 })
    expect(isDue(monthly, new Date('2024-06-15T13:05:00Z'), null, tz)).toBe(true)
    expect(isDue(monthly, new Date('2024-06-16T13:05:00Z'), null, tz)).toBe(false)
  })

  it('fires the next month, not again this month', () => {
    const monthly = daily({ frequency: 'monthly', day: 15 })
    const june = new Date('2024-06-15T13:05:00Z')
    expect(isDue(monthly, new Date('2024-06-15T20:00:00Z'), june, tz)).toBe(false)
    expect(isDue(monthly, new Date('2024-07-15T13:05:00Z'), june, tz)).toBe(true)
  })

  it('survives the spring-forward gap without skipping a day', () => {
    // 2024-03-10, New York skips 02:00-03:00. A 02:30 schedule never matches
    // that hour exactly, so the "past the time" comparison must carry it.
    const s = daily({ hour: 2, minute: 30 })
    const afterGap = new Date('2024-03-10T08:00:00Z') // 04:00 EDT
    expect(isDue(s, afterGap, null, tz)).toBe(true)
  })

  it('does not double-fire across the autumn repeated hour', () => {
    // 2024-11-03, 01:30 New York happens twice (EDT then EST).
    const s = daily({ hour: 1, minute: 30 })
    const firstPass = new Date('2024-11-03T05:30:00Z') // 01:30 EDT
    const secondPass = new Date('2024-11-03T06:30:00Z') // 01:30 EST
    expect(isDue(s, firstPass, null, tz)).toBe(true)
    // Same calendar day, so the same slot — it must not run again.
    expect(isDue(s, secondPass, firstPass, tz)).toBe(false)
  })

  it('fires an hourly schedule once per hour', () => {
    const hourly = daily({ frequency: 'hourly', minute: 10 })
    const at = new Date('2024-06-03T12:15:00Z')
    expect(isDue(hourly, at, null, tz)).toBe(true)
    expect(isDue(hourly, at, new Date('2024-06-03T12:11:00Z'), tz)).toBe(false)
    expect(isDue(hourly, new Date('2024-06-03T13:15:00Z'), at, tz)).toBe(true)
  })
})

describe('slotKey', () => {
  it('gives one key per period', () => {
    const tz = 'UTC'
    const a = new Date('2024-06-03T09:00:00Z')
    const b = new Date('2024-06-03T23:00:00Z')
    expect(slotKey(daily(), a, tz)).toBe(slotKey(daily(), b, tz))
    expect(slotKey(daily({ frequency: 'hourly' }), a, tz)).not.toBe(
      slotKey(daily({ frequency: 'hourly' }), b, tz),
    )
  })
})

describe('describeSchedule', () => {
  it('reads as a sentence', () => {
    expect(describeSchedule(daily())).toBe('Every day at 09:00')
    expect(describeSchedule(daily({ frequency: 'weekly', weekday: 5, hour: 17, minute: 30 }))).toBe(
      'Every Friday at 17:30',
    )
  })
})
