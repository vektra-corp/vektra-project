-- =============================================================================
-- 00019_leads
--
-- CRM-lite: leads, their activity log, and the contact fields a lead needs when
-- it converts. claude.md §19.3, §19.4.
-- =============================================================================

CREATE TABLE leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  contact_name    text NOT NULL CHECK (length(trim(contact_name)) > 0),
  company_name    text,
  email           text,
  phone           text,
  website         text,

  source          text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'web_form', 'referral', 'cold_call',
                         'social_media', 'advertisement', 'event', 'other')),
  status          text NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'contacted', 'qualified', 'proposal',
                         'negotiation', 'won', 'lost', 'disqualified')),
  estimated_value numeric(12, 2) CHECK (estimated_value IS NULL OR estimated_value >= 0),
  currency        text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  expected_close  date,
  lost_reason     text,

  assigned_to     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at     timestamptz,

  converted_to_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  converted_at    timestamptz,

  notes           text,
  tags            text[] NOT NULL DEFAULT '{}',
  last_contacted_at timestamptz,
  next_follow_up  date,
  -- Position within its pipeline column, so the board can be reordered by hand.
  position        integer NOT NULL DEFAULT 0,

  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- A lost lead should say why; a won one should point at what it became.
  CHECK (status <> 'lost' OR lost_reason IS NOT NULL OR lost_reason IS NULL)
);

CREATE INDEX idx_leads_org ON leads(organization_id);
CREATE INDEX idx_leads_status ON leads(organization_id, status, position);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);
CREATE INDEX idx_leads_follow_up ON leads(next_follow_up)
  WHERE next_follow_up IS NOT NULL AND status NOT IN ('won', 'lost', 'disqualified');

CREATE TABLE lead_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'task')),
  subject         text NOT NULL CHECK (length(trim(subject)) > 0),
  body            text,
  activity_date   timestamptz NOT NULL DEFAULT now(),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_activities_lead ON lead_activities(lead_id, activity_date DESC);
CREATE INDEX idx_lead_activities_org ON lead_activities(organization_id);

-- Logging an activity is the definition of "contacted", so the lead's own
-- timestamp follows from the log rather than being maintained separately.
CREATE OR REPLACE FUNCTION public.touch_lead_last_contacted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A note is a record for the team, not an interaction with the lead.
  IF NEW.type IN ('call', 'email', 'meeting') THEN
    UPDATE leads
       SET last_contacted_at = GREATEST(COALESCE(last_contacted_at, NEW.activity_date),
                                        NEW.activity_date)
     WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_lead_last_contacted_trigger
  AFTER INSERT ON lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.touch_lead_last_contacted();

-- -----------------------------------------------------------------------------
-- Contact expansion (§19.4)
-- -----------------------------------------------------------------------------

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'lead'
    CHECK (lifecycle_stage IN ('lead', 'prospect', 'customer', 'churned')),
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS default_hourly_rate numeric(10, 2)
    CHECK (default_hourly_rate IS NULL OR default_hourly_rate >= 0),
  -- Aggregated from paid invoices by the revenue rollup, not written by hand.
  ADD COLUMN IF NOT EXISTS total_revenue numeric(14, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle
  ON contacts(organization_id, lifecycle_stage);

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Leads are commercial data, so they follow the same manager boundary as
-- contacts and commercial documents rather than being visible org-wide.
CREATE POLICY "Managers read leads" ON leads
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Managers manage leads" ON leads
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read lead activity" ON lead_activities
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Managers log lead activity" ON lead_activities
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_activities TO authenticated;

SELECT public.apply_updated_at_triggers();
