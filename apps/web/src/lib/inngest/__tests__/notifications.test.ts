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
        project_public_id: 1739284650193847,
        task_public_id: 2846193847502938,
      }),
    ).toBe(
      'https://app.example.com/acme/delivery/projects/1739284650193847/tasks/2846193847502938',
    )
  })

  it('renders a public id from JSON without scientific notation or rounding', () => {
    // The value arrives as a JSON number. Anything that stringifies it wrongly
    // produces a URL that 404s, and it would 404 only for large ids.
    const url = notificationUrl(APP, 'acme', {
      workspace_slug: 'delivery',
      project_public_id: 8999999999999999,
      task_public_id: 1000000000000000,
    })
    expect(url).toContain('/projects/8999999999999999/')
    expect(url).toContain('/tasks/1000000000000000')
  })

  it('ignores a uuid where a public id belongs', () => {
    // Payloads written before migration 00036 carry uuids. There is no link to
    // build from those, so the inbox is the honest answer.
    expect(
      notificationUrl(APP, 'acme', {
        workspace_slug: 'delivery',
        project_public_id: '4e0e0a1e-0000-0000-0000-000000000001',
        task_public_id: '4e0e0a1e-0000-0000-0000-000000000002',
      }),
    ).toBe('https://app.example.com/acme/notifications')
  })

  it('falls back to the inbox rather than guessing a wrong task link', () => {
    expect(notificationUrl(APP, 'acme', { task_public_id: 2846193847502938 })).toBe(
      'https://app.example.com/acme/notifications',
    )
    expect(notificationUrl(APP, 'acme', null)).toBeNull()
  })
})
