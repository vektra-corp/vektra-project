-- =============================================================================
-- 00004_commercial
--
-- Contacts, quotations, purchase/sales orders, invoices, bills, PDF templates,
-- approval chains. claude.md §6.4 and §19.2.
--
-- Quotation is part of doc_type from the start rather than being bolted on by a
-- later ALTER, since this schema is being created fresh.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Contacts (clients and vendors)
-- CRM columns (lead_id, lifecycle_stage, ...) are added in 00010_crm.
-- -----------------------------------------------------------------------------

CREATE TABLE contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('client', 'vendor', 'both')),
  company_name    text,
  contact_name    text NOT NULL CHECK (length(trim(contact_name)) > 0),
  email           text,
  phone           text,
  address         jsonb,
  tax_id          text,
  notes           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_org ON contacts(organization_id);
CREATE INDEX idx_contacts_type ON contacts(organization_id, type);
CREATE INDEX idx_contacts_name ON contacts USING gin (contact_name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- PDF templates
-- -----------------------------------------------------------------------------

CREATE TABLE pdf_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type        text NOT NULL
                  CHECK (doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill', 'quotation')),
  name            text NOT NULL,
  template_data   jsonb NOT NULL,     -- Field positions, styles, header/footer blocks
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_templates_org ON pdf_templates(organization_id, doc_type);

CREATE UNIQUE INDEX idx_pdf_templates_default
  ON pdf_templates(organization_id, doc_type) WHERE is_default;

-- -----------------------------------------------------------------------------
-- Document numbering (business rule 4)
--
-- Numbers never repeat within an org and are never recycled. A counter row per
-- (org, doc_type, period) is incremented under a row lock, so concurrent
-- invoice creation cannot collide.
-- -----------------------------------------------------------------------------

CREATE TABLE commercial_doc_sequences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type        text NOT NULL
                  CHECK (doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill', 'quotation')),
  prefix          text NOT NULL,               -- 'INV', 'PO', 'QUO', ...
  -- Period the counter resets on. 'yearly' gives INV-2026-0001.
  reset_period    text NOT NULL DEFAULT 'yearly'
                  CHECK (reset_period IN ('never', 'yearly', 'monthly')),
  period_key      text NOT NULL DEFAULT '',    -- '2026' or '2026-03', '' when never
  padding         integer NOT NULL DEFAULT 4 CHECK (padding BETWEEN 1 AND 10),
  last_number     integer NOT NULL DEFAULT 0,
  UNIQUE (organization_id, doc_type, period_key)
);

CREATE OR REPLACE FUNCTION public.next_doc_number(
  org uuid,
  p_doc_type text,
  p_prefix text DEFAULT NULL,
  p_reset_period text DEFAULT 'yearly'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_key text;
  v_prefix     text;
  v_number     integer;
  v_padding    integer;
BEGIN
  v_period_key := CASE p_reset_period
    WHEN 'yearly'  THEN to_char(CURRENT_DATE, 'YYYY')
    WHEN 'monthly' THEN to_char(CURRENT_DATE, 'YYYY-MM')
    ELSE ''
  END;

  v_prefix := COALESCE(p_prefix, CASE p_doc_type
    WHEN 'invoice'        THEN 'INV'
    WHEN 'quotation'      THEN 'QUO'
    WHEN 'purchase_order' THEN 'PO'
    WHEN 'sales_order'    THEN 'SO'
    WHEN 'bill'           THEN 'BILL'
    ELSE 'DOC'
  END);

  INSERT INTO commercial_doc_sequences (organization_id, doc_type, prefix, reset_period, period_key, last_number)
  VALUES (org, p_doc_type, v_prefix, p_reset_period, v_period_key, 1)
  ON CONFLICT (organization_id, doc_type, period_key)
  DO UPDATE SET last_number = commercial_doc_sequences.last_number + 1
  RETURNING last_number, prefix, padding INTO v_number, v_prefix, v_padding;

  RETURN CASE
    WHEN v_period_key = '' THEN v_prefix || '-' || lpad(v_number::text, v_padding, '0')
    ELSE v_prefix || '-' || v_period_key || '-' || lpad(v_number::text, v_padding, '0')
  END;
END;
$$;

COMMENT ON FUNCTION public.next_doc_number IS
  'Atomically allocates the next document number for an org. Never reuses a number (business rule 4).';

-- -----------------------------------------------------------------------------
-- Commercial documents
-- -----------------------------------------------------------------------------

CREATE TABLE commercial_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,
  doc_type         text NOT NULL
                   CHECK (doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill', 'quotation')),
  doc_number       text NOT NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'draft',
  issue_date       date NOT NULL DEFAULT CURRENT_DATE,
  due_date         date,
  -- Quotations only: the offer expiry (§19.2).
  valid_until      date,
  currency         text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal         numeric(12, 2) NOT NULL DEFAULT 0,
  tax_total        numeric(12, 2) NOT NULL DEFAULT 0,
  discount_total   numeric(12, 2) NOT NULL DEFAULT 0,
  grand_total      numeric(12, 2) NOT NULL DEFAULT 0,
  amount_paid      numeric(12, 2) NOT NULL DEFAULT 0,
  notes            text,
  terms            text,
  pdf_template_id  uuid REFERENCES pdf_templates(id) ON DELETE SET NULL,
  -- SO references a PO, invoice references an SO, invoice references a quotation.
  reference_doc_id uuid REFERENCES commercial_documents(id) ON DELETE SET NULL,
  -- Set on a quotation when it is converted (§19.2).
  converted_to_id  uuid REFERENCES commercial_documents(id) ON DELETE SET NULL,
  metadata         jsonb NOT NULL DEFAULT '{}',
  approved_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  sent_at          timestamptz,
  viewed_at        timestamptz,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, doc_type, doc_number),
  CHECK (amount_paid >= 0 AND grand_total >= 0),
  -- Status must be legal for the document type (§6.4, §19.2).
  CHECK (
    CASE doc_type
      WHEN 'purchase_order' THEN status IN ('draft','pending_approval','approved','sent',
                                            'partially_received','received','closed')
      WHEN 'sales_order'    THEN status IN ('draft','confirmed','in_progress','fulfilled','closed')
      WHEN 'invoice'        THEN status IN ('draft','sent','viewed','partially_paid','paid',
                                            'overdue','void')
      WHEN 'bill'           THEN status IN ('received','pending_approval','approved',
                                            'partially_paid','paid')
      WHEN 'quotation'      THEN status IN ('draft','sent','viewed','accepted','rejected',
                                            'expired','converted')
    END
  ),
  -- valid_until only makes sense on a quotation.
  CHECK (valid_until IS NULL OR doc_type = 'quotation')
);

CREATE INDEX idx_commercial_docs_org ON commercial_documents(organization_id);
CREATE INDEX idx_commercial_docs_type ON commercial_documents(organization_id, doc_type);
CREATE INDEX idx_commercial_docs_status ON commercial_documents(organization_id, status);
CREATE INDEX idx_commercial_docs_contact ON commercial_documents(contact_id);
CREATE INDEX idx_commercial_docs_project ON commercial_documents(project_id);
CREATE INDEX idx_commercial_docs_workspace ON commercial_documents(workspace_id);
CREATE INDEX idx_commercial_docs_issue_date ON commercial_documents(organization_id, issue_date);

-- Unpaid-invoice lookups drive the revenue dashboard and dunning (§23.1).
CREATE INDEX idx_invoices_unpaid ON commercial_documents(organization_id, due_date)
  WHERE doc_type = 'invoice' AND status IN ('sent', 'viewed', 'overdue', 'partially_paid');

-- -----------------------------------------------------------------------------
-- Line items
-- -----------------------------------------------------------------------------

CREATE TABLE commercial_line_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES commercial_documents(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity        numeric(10, 2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price      numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  tax_rate        numeric(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  discount        numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total      numeric(12, 2) NOT NULL,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_line_items_document ON commercial_line_items(document_id, position);
CREATE INDEX idx_line_items_org ON commercial_line_items(organization_id);

-- Keep document totals in step with their line items. The same arithmetic lives
-- in @pm/shared/utils/currency for the client-side preview; this trigger is what
-- the database will actually persist.
-- SECURITY DEFINER: the total columns are revoked from end-user roles (00009)
-- precisely so they can only be written here, from the line items.
CREATE OR REPLACE FUNCTION public.recalculate_document_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_document_id uuid;
  v_subtotal    numeric(12, 2);
  v_discount    numeric(12, 2);
  v_tax         numeric(12, 2);
BEGIN
  v_document_id := COALESCE(NEW.document_id, OLD.document_id);

  SELECT
    COALESCE(SUM(round(quantity * unit_price, 2)), 0),
    COALESCE(SUM(LEAST(discount, round(quantity * unit_price, 2))), 0),
    COALESCE(SUM(round((round(quantity * unit_price, 2)
                        - LEAST(discount, round(quantity * unit_price, 2)))
                       * tax_rate / 100, 2)), 0)
  INTO v_subtotal, v_discount, v_tax
  FROM commercial_line_items
  WHERE document_id = v_document_id;

  UPDATE commercial_documents
     SET subtotal       = v_subtotal,
         discount_total = v_discount,
         tax_total      = v_tax,
         grand_total    = v_subtotal - v_discount + v_tax
   WHERE id = v_document_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER recalculate_document_totals_trigger
  AFTER INSERT OR UPDATE OR DELETE ON commercial_line_items
  FOR EACH ROW EXECUTE FUNCTION public.recalculate_document_totals();

-- Line total is derived, never supplied by the client.
CREATE OR REPLACE FUNCTION public.set_line_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_gross numeric(12, 2);
  v_net   numeric(12, 2);
BEGIN
  v_gross := round(NEW.quantity * NEW.unit_price, 2);
  v_net   := v_gross - LEAST(NEW.discount, v_gross);
  NEW.line_total := v_net + round(v_net * NEW.tax_rate / 100, 2);
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_line_total_trigger
  BEFORE INSERT OR UPDATE ON commercial_line_items
  FOR EACH ROW EXECUTE FUNCTION public.set_line_total();

-- -----------------------------------------------------------------------------
-- Approval chains
-- -----------------------------------------------------------------------------

CREATE TABLE approval_chains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type        text NOT NULL
                  CHECK (doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill', 'quotation')),
  name            text NOT NULL,
  conditions      jsonb NOT NULL DEFAULT '{}',   -- { "amount_gt": 5000 }
  steps           jsonb NOT NULL,                -- [{ "role": "manager", "required": true }]
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_chains_org ON approval_chains(organization_id, doc_type);

-- Per-document approval progress against a chain.
CREATE TABLE approval_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES commercial_documents(id) ON DELETE CASCADE,
  chain_id        uuid REFERENCES approval_chains(id) ON DELETE SET NULL,
  step_index      integer NOT NULL,
  required_role   text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  decided_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, step_index)
);

CREATE INDEX idx_approval_steps_document ON approval_steps(document_id);
CREATE INDEX idx_approval_steps_org ON approval_steps(organization_id, status);

SELECT public.apply_updated_at_triggers();
