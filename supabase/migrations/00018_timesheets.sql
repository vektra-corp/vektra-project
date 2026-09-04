-- =============================================================================
-- 00018_timesheets
--
-- Time tracking and weekly timesheet submission. claude.md §19.1.
-- =============================================================================

CREATE TABLE time_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE SET NULL,
  subtask_id      uuid REFERENCES subtasks(id) ON DELETE SET NULL,
  description     text,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz,
  duration_minutes integer NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  is_running      boolean NOT NULL DEFAULT false,
  is_billable     boolean NOT NULL DEFAULT true,
  hourly_rate     numeric(10, 2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  -- Derived, never client-written: a stored total that can disagree with its
  -- own inputs is the classic source of billing disputes.
  total_amount    numeric(12, 2) GENERATED ALWAYS AS (
    CASE WHEN hourly_rate IS NOT NULL
      THEN round((duration_minutes / 60.0) * hourly_rate, 2)
      ELSE NULL
    END
  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (end_time IS NULL OR end_time >= start_time),
  -- A running timer has no end; a stopped one must have both.
  CHECK ((is_running AND end_time IS NULL) OR NOT is_running)
);

CREATE INDEX idx_time_entries_user ON time_entries(user_id, organization_id);
CREATE INDEX idx_time_entries_task ON time_entries(task_id);
CREATE INDEX idx_time_entries_project ON time_entries(project_id);
CREATE INDEX idx_time_entries_date ON time_entries(organization_id, start_time);

-- Only one timer may run per person. A partial unique index makes that a
-- database guarantee rather than something every caller has to remember —
-- a second "Start" is refused even if two tabs race.
CREATE UNIQUE INDEX idx_time_entries_one_running
  ON time_entries(user_id) WHERE is_running;

/**
 * Keep duration in step with the clock.
 *
 * Stopping a timer sets end_time; the duration follows from it. A manual entry
 * supplies duration_minutes directly and has no end_time, so it is left alone.
 */
CREATE OR REPLACE FUNCTION public.sync_time_entry_duration()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.end_time IS NOT NULL THEN
    NEW.duration_minutes := GREATEST(
      0,
      round(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60.0)::int
    );
    NEW.is_running := false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_time_entry_duration_trigger
  BEFORE INSERT OR UPDATE OF start_time, end_time ON time_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_time_entry_duration();

-- -----------------------------------------------------------------------------
-- Timesheet periods
-- -----------------------------------------------------------------------------

CREATE TABLE timesheet_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  total_hours     numeric(6, 2) NOT NULL DEFAULT 0 CHECK (total_hours >= 0),
  billable_hours  numeric(6, 2) NOT NULL DEFAULT 0 CHECK (billable_hours >= 0),
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at    timestamptz,
  approved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  rejection_note  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, user_id, period_start),
  CHECK (period_end >= period_start)
);

CREATE INDEX idx_timesheet_periods_user ON timesheet_periods(user_id, period_start);
CREATE INDEX idx_timesheet_periods_pending
  ON timesheet_periods(organization_id) WHERE status = 'submitted';

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- Your own time, or anyone's if you manage people. Entries are personal data
-- about how someone spent their day, so a plain member sees only their own.
CREATE POLICY "Users read their own time" ON time_entries
  FOR SELECT USING (
    organization_id = public.org_id()
    AND (user_id = auth.uid() OR public.has_org_role('manager'))
  );

CREATE POLICY "Users log their own time" ON time_entries
  FOR INSERT WITH CHECK (organization_id = public.org_id() AND user_id = auth.uid());

CREATE POLICY "Users edit their own time" ON time_entries
  FOR UPDATE USING (organization_id = public.org_id() AND user_id = auth.uid())
  WITH CHECK (organization_id = public.org_id() AND user_id = auth.uid());

CREATE POLICY "Users delete their own time" ON time_entries
  FOR DELETE USING (organization_id = public.org_id() AND user_id = auth.uid());

CREATE POLICY "Admins manage all time" ON time_entries
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE timesheet_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own timesheets" ON timesheet_periods
  FOR SELECT USING (
    organization_id = public.org_id()
    AND (user_id = auth.uid() OR public.has_org_role('manager'))
  );

CREATE POLICY "Users submit their own timesheets" ON timesheet_periods
  FOR INSERT WITH CHECK (organization_id = public.org_id() AND user_id = auth.uid());

CREATE POLICY "Users update their own draft timesheets" ON timesheet_periods
  FOR UPDATE USING (
    organization_id = public.org_id()
    AND user_id = auth.uid()
    AND status IN ('draft', 'rejected')
  )
  WITH CHECK (organization_id = public.org_id() AND user_id = auth.uid());

CREATE POLICY "Managers decide timesheets" ON timesheet_periods
  FOR UPDATE USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON timesheet_periods TO authenticated;

SELECT public.apply_updated_at_triggers();
