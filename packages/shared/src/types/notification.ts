import type { DigestMode, NotificationType } from '../constants/statuses'
import type { Json, UUID } from './common'

export interface Notification {
  id: UUID
  organization_id: UUID
  user_id: UUID
  type: NotificationType
  title: string
  body: string | null
  data: Record<string, Json> | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

export interface NotificationChannels {
  email: boolean
  push: boolean
  in_app: boolean
}

export interface QuietHours {
  start: string
  end: string
  timezone: string
}

export interface NotificationPreferences {
  id: UUID
  user_id: UUID
  organization_id: UUID
  preferences: Partial<Record<NotificationType, NotificationChannels>>
  quiet_hours: QuietHours | null
  digest_mode: DigestMode
}

/** Applied when a user has no explicit preference for a notification type. */
export const DEFAULT_NOTIFICATION_CHANNELS: NotificationChannels = {
  email: true,
  push: false,
  in_app: true,
}
