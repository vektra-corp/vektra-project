-- =============================================================================
-- 00024_workflow_run_idempotency
--
-- Make it impossible to run a workflow twice for the same event.
--
-- The dispatcher polls the `events` table, because Postgres triggers cannot call
-- Inngest. `events.processed` is a single shared boolean and other consumers are
-- meant to read the same rows (§12 integration dispatch), so the dispatcher
-- cannot use it as its cursor without stealing events from them.
--
-- Instead the run itself carries the event id, and this index refuses a second
-- run for the same (workflow, event). A retried or overlapping poll gets a
-- unique violation rather than firing the actions again — which for a workflow
-- that sends mail or calls a webhook is the difference between at-least-once
-- and exactly-once.
-- =============================================================================

CREATE UNIQUE INDEX idx_workflow_runs_event
  ON workflow_runs (workflow_id, (trigger_data ->> 'event_id'))
  WHERE trigger_data ? 'event_id';

COMMENT ON INDEX idx_workflow_runs_event IS
  'Idempotency for the event-driven dispatcher: one run per workflow per source event.';

-- The dispatcher scans recent events by type; the existing index leads with
-- organization_id, which it does not filter on.
CREATE INDEX IF NOT EXISTS idx_events_recent
  ON events (created_at DESC, event_type);
