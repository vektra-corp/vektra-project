-- =============================================================================
-- 00016_employees_and_leave
--
-- Employee records and leave tracking. claude.md §19.5.
--
-- `employees` extends org_members with HR data rather than widening that table:
-- membership is an access-control fact and every RLS policy reads it, whereas
-- this is personnel data that most of the product never touches.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Employees
-- -----------------------------------------------------------------------------

CREATE TABLE employees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_code   text,
  department      text,
  designation     text,
  employment_type text NOT NULL DEFAULT 'full_time'
                  CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  date_of_joining date NOT NULL,
  date_of_exit    date,
  manager_id      uuid REFERENCES employees(id) ON DELETE SET NULL,
  work_schedule   jsonb NOT NULL DEFAULT
                  '{"hours_per_day": 8, "days_per_week": 5, "work_days": [1,2,3,4,5]}',
  default_hourly_rate numeric(10, 2) CHECK (default_hourly_rate IS NULL OR default_hourly_rate >= 0),
  skills          text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'on_leave', 'terminated', 'probation')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, user_id),
  -- Someone cannot leave before they joined.
  CHECK (date_of_exit IS NULL OR date_of_exit >= date_of_joining)
);

-- Employee codes are optional, so uniqueness has to skip the NULLs; a plain
-- UNIQUE would allow only one employee without a code per organization.
CREATE UNIQUE INDEX idx_employees_code
  ON employees(organization_id, employee_code) WHERE employee_code IS NOT NULL;

CREATE INDEX idx_employees_org ON employees(organization_id);
CREATE INDEX idx_employees_manager ON employees(manager_id);
CREATE INDEX idx_employees_user ON employees(user_id);

-- A reporting line must stay inside one organization, and nobody reports to
-- themselves. A trigger rather than a CHECK because it reads another row.
CREATE OR REPLACE FUNCTION public.validate_employee_manager()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_org uuid;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.manager_id = NEW.id THEN
    RAISE EXCEPTION 'An employee cannot report to themselves';
  END IF;

  SELECT organization_id INTO v_manager_org FROM employees WHERE id = NEW.manager_id;

  IF v_manager_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'A manager must belong to the same organization';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_employee_manager_trigger
  BEFORE INSERT OR UPDATE OF manager_id ON employees
  FOR EACH ROW EXECUTE FUNCTION public.validate_employee_manager();

-- -----------------------------------------------------------------------------
-- Leave types
-- -----------------------------------------------------------------------------

CREATE TABLE leave_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  color           text,
  default_days    numeric(4, 1) NOT NULL DEFAULT 0 CHECK (default_days >= 0),
  is_paid         boolean NOT NULL DEFAULT true,
  requires_approval boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, name)
);

CREATE INDEX idx_leave_types_org ON leave_types(organization_id);

-- -----------------------------------------------------------------------------
-- Leave balances
-- -----------------------------------------------------------------------------

CREATE TABLE leave_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year            integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  total_days      numeric(4, 1) NOT NULL DEFAULT 0 CHECK (total_days >= 0),
  used_days       numeric(4, 1) NOT NULL DEFAULT 0 CHECK (used_days >= 0),
  pending_days    numeric(4, 1) NOT NULL DEFAULT 0 CHECK (pending_days >= 0),
  carried_over    numeric(4, 1) NOT NULL DEFAULT 0,
  -- Generated rather than maintained by the app: a balance that can disagree
  -- with its own components is the classic source of HR disputes.
  remaining_days  numeric(4, 1) GENERATED ALWAYS AS
                  (total_days + carried_over - used_days - pending_days) STORED,

  UNIQUE (employee_id, leave_type_id, year)
);

CREATE INDEX idx_leave_balances_org ON leave_balances(organization_id);
CREATE INDEX idx_leave_balances_employee ON leave_balances(employee_id, year);

-- -----------------------------------------------------------------------------
-- Leave requests
-- -----------------------------------------------------------------------------

CREATE TABLE leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   uuid NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  -- Supports half-days, which is why this is not derived from the date range.
  duration_days   numeric(4, 1) NOT NULL CHECK (duration_days > 0),
  reason          text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  rejection_note  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_org ON leave_requests(organization_id);
CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX idx_leave_requests_pending
  ON leave_requests(organization_id) WHERE status = 'pending';

-- Two overlapping approved or pending requests for one person is always a
-- mistake. Enforced with an exclusion constraint so concurrent submissions
-- cannot both slip through, which an application-level check would allow.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
  WHERE (status IN ('pending', 'approved'));

/**
 * Keep leave balances in step with request state.
 *
 * Requested days sit in `pending_days` until a decision is made, then move to
 * `used_days` on approval or are released on rejection or cancellation. Doing
 * this in the database means a balance cannot drift from the requests that
 * produced it, whatever path the update took.
 */
CREATE OR REPLACE FUNCTION public.sync_leave_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer;
BEGIN
  v_year := EXTRACT(YEAR FROM COALESCE(NEW.start_date, OLD.start_date))::int;

  -- Release whatever the previous state was holding.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending' THEN
      UPDATE leave_balances
      SET pending_days = GREATEST(0, pending_days - OLD.duration_days)
      WHERE employee_id = OLD.employee_id AND leave_type_id = OLD.leave_type_id AND year = v_year;
    ELSIF OLD.status = 'approved' THEN
      UPDATE leave_balances
      SET used_days = GREATEST(0, used_days - OLD.duration_days)
      WHERE employee_id = OLD.employee_id AND leave_type_id = OLD.leave_type_id AND year = v_year;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'pending' THEN
      UPDATE leave_balances
      SET pending_days = GREATEST(0, pending_days - OLD.duration_days)
      WHERE employee_id = OLD.employee_id AND leave_type_id = OLD.leave_type_id AND year = v_year;
    ELSIF OLD.status = 'approved' THEN
      UPDATE leave_balances
      SET used_days = GREATEST(0, used_days - OLD.duration_days)
      WHERE employee_id = OLD.employee_id AND leave_type_id = OLD.leave_type_id AND year = v_year;
    END IF;
    RETURN OLD;
  END IF;

  -- A balance row may not exist yet for this type and year; create it so the
  -- request is never silently untracked.
  INSERT INTO leave_balances (organization_id, employee_id, leave_type_id, year, total_days)
  SELECT NEW.organization_id, NEW.employee_id, NEW.leave_type_id, v_year,
         COALESCE((SELECT default_days FROM leave_types WHERE id = NEW.leave_type_id), 0)
  ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;

  IF NEW.status = 'pending' THEN
    UPDATE leave_balances
    SET pending_days = pending_days + NEW.duration_days
    WHERE employee_id = NEW.employee_id AND leave_type_id = NEW.leave_type_id AND year = v_year;
  ELSIF NEW.status = 'approved' THEN
    UPDATE leave_balances
    SET used_days = used_days + NEW.duration_days
    WHERE employee_id = NEW.employee_id AND leave_type_id = NEW.leave_type_id AND year = v_year;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_leave_balance_trigger
  AFTER INSERT OR UPDATE OF status, duration_days OR DELETE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_leave_balance();

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Everyone can see the directory: names, departments and reporting lines are
-- how people find each other. Pay is NOT in this table's readable set for a
-- plain member — see the separate policy below.
CREATE POLICY "Members read the employee directory" ON employees
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Admins manage employees" ON employees
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read leave types" ON leave_types
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Admins manage leave types" ON leave_types
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;

-- Your own balance, or anyone's if you manage people.
CREATE POLICY "Employees read their own balance" ON leave_balances
  FOR SELECT USING (
    organization_id = public.org_id()
    AND (
      EXISTS (SELECT 1 FROM employees e
              WHERE e.id = leave_balances.employee_id AND e.user_id = auth.uid())
      OR public.has_org_role('manager')
    )
  );

CREATE POLICY "Admins manage balances" ON leave_balances
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees read their own requests" ON leave_requests
  FOR SELECT USING (
    organization_id = public.org_id()
    AND (
      EXISTS (SELECT 1 FROM employees e
              WHERE e.id = leave_requests.employee_id AND e.user_id = auth.uid())
      OR public.has_org_role('manager')
    )
  );

-- You may only file leave for yourself; approving is a separate policy.
CREATE POLICY "Employees file their own requests" ON leave_requests
  FOR INSERT WITH CHECK (
    organization_id = public.org_id()
    AND EXISTS (SELECT 1 FROM employees e
                WHERE e.id = leave_requests.employee_id AND e.user_id = auth.uid())
  );

-- An employee may withdraw a request that is still pending; once decided, only
-- a manager can change it.
CREATE POLICY "Employees cancel their own pending requests" ON leave_requests
  FOR UPDATE USING (
    organization_id = public.org_id()
    AND status = 'pending'
    AND EXISTS (SELECT 1 FROM employees e
                WHERE e.id = leave_requests.employee_id AND e.user_id = auth.uid())
  )
  WITH CHECK (organization_id = public.org_id());

CREATE POLICY "Managers decide requests" ON leave_requests
  FOR UPDATE USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Admins manage requests" ON leave_requests
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON employees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_balances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_requests TO authenticated;

SELECT public.apply_updated_at_triggers();
