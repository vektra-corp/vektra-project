-- =============================================================================
-- 00023_drop_leads
--
-- Remove the lead management module (added in 00019).
--
-- Dropped rather than left dormant: an unused table still appears in generated
-- types, in the RLS audit, and in every "which tables exist" answer, and an
-- empty module invites someone to half-use it later. 00019 stays in the
-- migration history as the record of what was there.
--
-- `contacts.lifecycle_stage` is KEPT. It happens to include 'lead' as a value,
-- but it describes where a contact sits in its own lifecycle and is useful
-- without a leads table behind it.
-- =============================================================================

-- The only inbound reference. Dropped before the table so the cascade is
-- explicit rather than implied by DROP ... CASCADE.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_lead_id_fkey;
ALTER TABLE contacts DROP COLUMN IF EXISTS lead_id;

-- lead_activities is FK'd to leads, so it goes first.
DROP TABLE IF EXISTS lead_activities;
DROP TABLE IF EXISTS leads;

DROP FUNCTION IF EXISTS public.touch_lead_last_contacted();

-- saved_reports could target a 'lead' entity that no longer exists. Rewrite the
-- constraint, and clear any rows that referenced it — there is nothing left for
-- such a report to read.
DELETE FROM saved_reports WHERE entity_type = 'lead';

ALTER TABLE saved_reports DROP CONSTRAINT IF EXISTS saved_reports_entity_type_check;
ALTER TABLE saved_reports
  ADD CONSTRAINT saved_reports_entity_type_check
  CHECK (entity_type IN ('task', 'timesheet', 'commercial', 'employee'));

COMMENT ON COLUMN contacts.lifecycle_stage IS
  'Where this contact sits in its own lifecycle. Retained after the leads module was removed in 00023; it does not depend on a leads table.';
