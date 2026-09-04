/**
 * Schedule triggers (§11).
 *
 * CLAUDE.md gives `workflows.cron_expression` for this, but a free-text cron
 * field is a poor contract: the editor cannot offer a sane UI for it, and a
 * half-implemented parser silently mis-fires. So the schedule is stored
 * structurally in `trigger_config` and the equivalent cron string is written to
 * `cron_expression` for display and portability. The structure is the source of
 * truth; the string is derived.
 *
 * Everything here is pure. `isDue` takes the current time explicitly so the
 * behaviour at a DST boundary or a month end can be tested rather than hoped
 * for.
 *
 * §21.6: schedules run in the ORGANISATION's timezone, not UTC. "Every day at
 * 09:00" means 09:00 where the customer is.
 */

export const SCHEDULE_FREQUENCIES = ['hourly', 'daily', 'weekly', 'monthly'] as const
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number]

export interface WorkflowSchedule {
  frequency: ScheduleFrequency
  /** 0-23. Ignored when hourly. */
  hour: number
  /** 0-59. */
  minute: number
  /** 0 = Sunday. Weekly only. */
  weekday: number
  /** 1-28. Weekly/daily ignore it. Capped at 28 so every month has the day. */
  day: number
}

export const DEFAULT_SCHEDULE: WorkflowSchedule = {
  frequency: 'daily',
  hour: 9,
  minute: 0,
  weekday: 1,
  day: 1,
}

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function parseSchedule(config: unknown): WorkflowSchedule {
  const raw = (config ?? {}) as Record<string, unknown>
  const frequency = (SCHEDULE_FREQUENCIES as readonly string[]).includes(raw.frequency as string)
    ? (raw.frequency as ScheduleFrequency)
    : DEFAULT_SCHEDULE.frequency

  return {
    frequency,
    hour: clamp(raw.hour, 0, 23, DEFAULT_SCHEDULE.hour),
    minute: clamp(raw.minute, 0, 59, DEFAULT_SCHEDULE.minute),
    weekday: clamp(raw.weekday, 0, 6, DEFAULT_SCHEDULE.weekday),
    // 29-31 do not exist in every month; capping avoids a schedule that skips
    // February rather than one that runs slightly early.
    day: clamp(raw.day, 1, 28, DEFAULT_SCHEDULE.day),
  }
}

/** The cron string this schedule is equivalent to, for display. */
export function scheduleToCron(schedule: WorkflowSchedule): string {
  const { frequency, hour, minute, weekday, day } = schedule
  switch (frequency) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * ${weekday}`
    case 'monthly':
      return `${minute} ${hour} ${day} * *`
  }
}

export function describeSchedule(schedule: WorkflowSchedule): string {
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  switch (schedule.frequency) {
    case 'hourly':
      return `Every hour at :${String(schedule.minute).padStart(2, '0')}`
    case 'daily':
      return `Every day at ${time}`
    case 'weekly':
      return `Every ${days[schedule.weekday]} at ${time}`
    case 'monthly':
      return `On day ${schedule.day} of each month at ${time}`
  }
}

/**
 * The wall-clock fields of `instant` as seen in `timeZone`.
 *
 * `Intl` is the only correct way to do this — offset arithmetic gets DST wrong
 * twice a year, and those are exactly the days a customer notices.
 */
export function zonedParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(instant)
  } catch {
    // An unknown zone must not take the scheduler down; UTC is the documented
    // fallback everywhere else in the app.
    return zonedParts(instant, 'UTC')
  }

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0'
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    // `hour12: false` yields 24 rather than 0 for midnight in some engines.
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: Math.max(0, weekdays.indexOf(get('weekday'))),
  }
}

/**
 * The slot key a moment falls in — two instants in the same slot are the same
 * scheduled occurrence.
 *
 * Comparing slot keys is what makes the poller idempotent. The alternative,
 * "has enough time passed since last_run_at", drifts: a poll a minute late
 * pushes every subsequent run later.
 */
export function slotKey(schedule: WorkflowSchedule, at: Date, timeZone: string): string {
  const { year, month, day, hour, weekday } = zonedParts(at, timeZone)
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  switch (schedule.frequency) {
    case 'hourly':
      return `${date}T${String(hour).padStart(2, '0')}`
    case 'daily':
      return date
    case 'weekly':
      // Anchor to the start of the week so a Monday schedule has one slot per week.
      return `${date}/w${weekday}`
    case 'monthly':
      return `${year}-${String(month).padStart(2, '0')}`
  }
}

/**
 * Whether a scheduled workflow should run now.
 *
 * `now` must be at or past the scheduled time within the current slot, and the
 * slot must differ from the one `lastRunAt` fell in. The poller runs every few
 * minutes, so a run fires in the first poll after its time — never twice, and
 * never a second time because the poller was slow.
 */
export function isDue(
  schedule: WorkflowSchedule,
  now: Date,
  lastRunAt: Date | null,
  timeZone: string,
): boolean {
  const parts = zonedParts(now, timeZone)

  const reachedTime = (() => {
    switch (schedule.frequency) {
      case 'hourly':
        return parts.minute >= schedule.minute
      case 'daily':
        return parts.hour > schedule.hour
          || (parts.hour === schedule.hour && parts.minute >= schedule.minute)
      case 'weekly':
        if (parts.weekday !== schedule.weekday) return false
        return parts.hour > schedule.hour
          || (parts.hour === schedule.hour && parts.minute >= schedule.minute)
      case 'monthly':
        if (parts.day !== schedule.day) return false
        return parts.hour > schedule.hour
          || (parts.hour === schedule.hour && parts.minute >= schedule.minute)
    }
  })()

  if (!reachedTime) return false
  if (!lastRunAt) return true

  return slotKey(schedule, now, timeZone) !== slotKey(schedule, lastRunAt, timeZone)
}
