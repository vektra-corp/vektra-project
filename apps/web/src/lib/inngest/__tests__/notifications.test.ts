import { describe, expect, it } from 'vitest'
import { digestModeOf, inQuietHours, notificationUrl, preferenceFor } from '../notifications'

describe('preferenceFor', () => {
  it('defaults to email on when nothing is configured', () => {
    expect(preferenceFor(null, 'task_assigned').email).toBe(true)
    expect(preferenceFor({}, 'task_assigned').email).toBe(true)
  })

  it('honours an explicit opt-out for one type only', () => {
    const prefs = { task_assigned: { email: false, push: false, in_app: true } }
    expect(preferenceFor(prefs, 'task_assigned').email).toBe(false)
    expect(preferenceFor(prefs, 'comment_mention').email).toBe(true)
  })

  it('fills missing channels from the default rather than undefined', () => {
    const prefs = { task_assigned: { push: true } }
    expect(preferenceFor(prefs, 'task_assigned')).toEqual({
      email: true,
      push: true,
      in_app: true,
    })
  })
})

describe('inQuietHours', () => {
  const window = { start: '22:00', end: '08:00', timezone: 'UTC' }

  it('handles a window that crosses midnight', () => {
    expect(inQuietHours(window, new Date('2026-09-02T23:30:00Z'))).toBe(true)
    expect(inQuietHours(window, new Date('2026-09-02T03:00:00Z'))).toBe(true)
    expect(inQuietHours(window, new Date('2026-09-02T12:00:00Z'))).toBe(false)
  })

  it('handles a same-day window', () => {
    const lunch = { start: '12:00', end: '13:00', timezone: 'UTC' }
    expect(inQuietHours(lunch, new Date('2026-09-02T12:30:00Z'))).toBe(true)
    expect(inQuietHours(lunch, new Date('2026-09-02T13:00:00Z'))).toBe(false)
    expect(inQuietHours(lunch, new Date('2026-09-02T11:59:00Z'))).toBe(false)
  })

  it('evaluates in the user timezone, not the server one', () => {
    const tokyo = { start: '22:00', end: '08:00', timezone: 'Asia/Tokyo' }
    // 14:00 UTC is 23:00 in Tokyo — quiet there, working hours in UTC.
    expect(inQuietHours(tokyo, new Date('2026-09-02T14:00:00Z'))).toBe(true)
    expect(inQuietHours({ ...tokyo, timezone: 'UTC' }, new Date('2026-09-02T14:00:00Z'))).toBe(
      false,
    )
  })

  it('never silences notifications on malformed input', () => {
    expect(inQuietHours(null, new Date())).toBe(false)
    expect(inQuietHours({ start: '22:00' }, new Date())).toBe(false)
    expect(inQuietHours({ start: '22:00', end: '08:00', timezone: 'Not/AZone' }, new Date())).toBe(
      false,
    )
  })
})

describe('digestModeOf', () => {
  it('falls back to instant for anything unrecognised', () => {
    expect(digestModeOf('daily')).toBe('daily')
    expect(digestModeOf('hourly')).toBe('hourly')
    expect(digestModeOf('weekly')).toBe('instant')
    expect(digestModeOf(null)).toBe('instant')
  })
})

describe('notificationUrl', () => {
  const APP = 'https://app.example.com'

  it('deep-links when the payload carries the full path', () => {
    expect(
      notificationUrl(APP, 'acme', {
        workspace_slug: 'delivery',
        project_id: 'p1',
        task_id: 't1',
      }),
    ).toBe('https://app.example.com/acme/delivery/projects/p1/tasks/t1')
  })

  it('falls back to the inbox rather than guessing a wrong task link', () => {
    expect(notificationUrl(APP, 'acme', { task_id: 't1' })).toBe(
      'https://app.example.com/acme/notifications',
    )
    expect(notificationUrl(APP, 'acme', null)).toBeNull()
  })
})
