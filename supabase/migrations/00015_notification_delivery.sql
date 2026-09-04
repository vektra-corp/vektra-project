-- Email delivery bookkeeping for notifications.
--
-- The in-app notification is written by a trigger the moment something happens;
-- the email is sent later by a background job. That job needs to know what it
-- has already sent, and it must never send twice — so delivery state lives on
-- the row rather than in the job.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;

COMMENT ON COLUMN notifications.emailed_at IS
  'When the email for this notification was handed to the provider. NULL means not yet sent; set once, never cleared.';

-- The delivery job asks exactly one question: which recent notifications are
-- still unsent? A partial index keeps that scan proportional to the backlog
-- rather than to the whole table, which only ever grows.
CREATE INDEX IF NOT EXISTS idx_notifications_pending_email
  ON notifications (created_at)
  WHERE emailed_at IS NULL;

-- Background jobs run as service_role and bypass RLS, but a user must never be
-- able to rewrite their own delivery state to force a resend. Existing policies
-- already limit UPDATE to marking a notification read; this makes the intent
-- explicit for anyone adding a policy later.
COMMENT ON TABLE notifications IS
  'In-app notifications. emailed_at is written only by the delivery job (service_role); user-facing updates are limited to is_read/read_at.';
