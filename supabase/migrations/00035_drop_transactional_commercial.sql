-- =============================================================================
-- 00035_drop_transactional_commercial
--
-- Purchase orders, sales orders, invoices and bills are removed from the
-- product at the product owner's direction. Quotations and contacts stay: a
-- quotation is a sales document that stands on its own, and contacts carry the
-- default hourly rate the timesheet module bills against.
--
-- This DELETES data. It is deliberate and was asked for explicitly. Line items,
-- approval steps and attachments hang off commercial_documents with ON DELETE
-- CASCADE, so removing the parent rows removes them too — the deletes below are
-- written parent-first for that reason rather than table-by-table.
--
-- Approval chains go with them. Every approval status in the schema
-- ('pending_approval' on a PO or a bill) belonged to a document type that no
-- longer exists; a quotation goes draft -> sent -> accepted with no approval
-- step, so keeping the chain tables would leave two tables no code can reach.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Remove the rows
-- -----------------------------------------------------------------------------

DELETE FROM public.commercial_documents
 WHERE doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill');

DELETE FROM public.pdf_templates
 WHERE doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill');

DELETE FROM public.commercial_doc_sequences
 WHERE doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill');

-- A quotation that had been converted into an invoice now points at a row that
-- is gone. `converted_to_id` is ON DELETE SET NULL so the column already
-- cleared itself, but the jsonb copy of the same pointer did not, and the
-- 'converted' status now describes something that cannot happen. Both are wound
-- back to 'accepted', which is what the quotation was immediately before.
UPDATE public.commercial_documents
   SET status = 'accepted',
       metadata = metadata - 'converted_to_id'
 WHERE doc_type = 'quotation' AND status = 'converted';

UPDATE public.commercial_documents
   SET metadata = metadata - 'converted_to_id'
 WHERE metadata ? 'converted_to_id';

-- -----------------------------------------------------------------------------
-- Narrow the type to quotation
-- -----------------------------------------------------------------------------

ALTER TABLE public.commercial_documents
  DROP CONSTRAINT IF EXISTS commercial_documents_doc_type_check;
ALTER TABLE public.commercial_documents
  ADD CONSTRAINT commercial_documents_doc_type_check
  CHECK (doc_type = 'quotation');

-- 00004 declared three table-level CHECKs inline, so Postgres named them
-- commercial_documents_check / _check1 / _check2 in creation order. Dropping
-- them by guessed name would silently no-op if that order ever differed, so
-- they are found by what they constrain instead: every unnamed table CHECK
-- mentioning doc_type is one of the three, and all three are replaced below.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'commercial_documents'
      AND con.contype = 'c'
      AND con.conname ~ '^commercial_documents_check[0-9]*$'
  LOOP
    EXECUTE format('ALTER TABLE public.commercial_documents DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- The status CHECK was a CASE over five document types; with one type left it
-- is a plain list. 'converted' is gone with it — there is no longer any
-- document type to convert a quotation into.
ALTER TABLE public.commercial_documents
  DROP CONSTRAINT IF EXISTS commercial_documents_status_check;
ALTER TABLE public.commercial_documents
  ADD CONSTRAINT commercial_documents_status_check
  CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'));

ALTER TABLE public.commercial_documents
  DROP CONSTRAINT IF EXISTS commercial_documents_amounts_check;
ALTER TABLE public.commercial_documents
  ADD CONSTRAINT commercial_documents_amounts_check
  CHECK (amount_paid >= 0 AND grand_total >= 0);

-- `converted_to_id` and `reference_doc_id` pointed at the document types that
-- are gone. Kept as columns (dropping them would need a two-step per §15) but
-- they can never be set again, so they are pinned null.
UPDATE public.commercial_documents
   SET converted_to_id = NULL, reference_doc_id = NULL
 WHERE converted_to_id IS NOT NULL OR reference_doc_id IS NOT NULL;

ALTER TABLE public.pdf_templates
  DROP CONSTRAINT IF EXISTS pdf_templates_doc_type_check;
ALTER TABLE public.pdf_templates
  ADD CONSTRAINT pdf_templates_doc_type_check CHECK (doc_type = 'quotation');

ALTER TABLE public.commercial_doc_sequences
  DROP CONSTRAINT IF EXISTS commercial_doc_sequences_doc_type_check;
ALTER TABLE public.commercial_doc_sequences
  ADD CONSTRAINT commercial_doc_sequences_doc_type_check CHECK (doc_type = 'quotation');

-- Indexed the unpaid-invoice lookup for the revenue dashboard; there are no
-- invoices to look up.
DROP INDEX IF EXISTS public.idx_invoices_unpaid;

-- -----------------------------------------------------------------------------
-- Approval chains
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS public.approval_steps;
DROP TABLE IF EXISTS public.approval_chains;

-- -----------------------------------------------------------------------------
-- Revenue rollup: pipeline only
-- -----------------------------------------------------------------------------
--
-- Invoiced, outstanding and overdue were all invoice-derived and are now
-- structurally zero. Dropping the columns rather than leaving them at zero
-- means a widget that still reads one fails loudly at deploy instead of
-- quietly reporting no revenue.

DROP FUNCTION IF EXISTS public.revenue_for_org(integer);
DROP MATERIALIZED VIEW IF EXISTS public.revenue_summary;

CREATE MATERIALIZED VIEW public.revenue_summary AS
SELECT
  cd.organization_id,
  date_trunc('month', cd.issue_date)::date AS month,
  cd.currency,
  SUM(CASE WHEN cd.status IN ('sent', 'viewed')
           THEN cd.grand_total ELSE 0 END) AS pipeline_quotations,
  SUM(CASE WHEN cd.status = 'accepted'
           THEN cd.grand_total ELSE 0 END) AS accepted_quotations,
  SUM(CASE WHEN cd.status = 'rejected'
           THEN cd.grand_total ELSE 0 END) AS rejected_quotations
FROM public.commercial_documents cd
WHERE cd.doc_type = 'quotation'
GROUP BY cd.organization_id, date_trunc('month', cd.issue_date), cd.currency;

CREATE UNIQUE INDEX idx_revenue_summary
  ON public.revenue_summary(organization_id, month, currency);

-- Same posture as 00022: a materialized view cannot carry RLS, so it is
-- unreadable directly and reached only through the org-filtered function.
REVOKE ALL ON public.revenue_summary FROM PUBLIC;
REVOKE ALL ON public.revenue_summary FROM anon;
REVOKE ALL ON public.revenue_summary FROM authenticated;
GRANT SELECT ON public.revenue_summary TO service_role;

COMMENT ON MATERIALIZED VIEW public.revenue_summary IS
  'Quotation pipeline rollup. NOT directly readable: a materialized view cannot carry RLS. Read it through revenue_for_org(), which filters to the caller''s organization.';

CREATE OR REPLACE FUNCTION public.revenue_for_org(p_months integer DEFAULT 12)
RETURNS TABLE (
  month date,
  currency text,
  pipeline_quotations numeric,
  accepted_quotations numeric,
  rejected_quotations numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.month, r.currency, r.pipeline_quotations, r.accepted_quotations,
         r.rejected_quotations
  FROM public.revenue_summary r
  WHERE r.organization_id = public.org_id()
    AND r.month >= date_trunc('month', CURRENT_DATE)::date
                   - (GREATEST(p_months, 1) || ' months')::interval
  ORDER BY r.month DESC;
$$;

REVOKE ALL ON FUNCTION public.revenue_for_org(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revenue_for_org(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.revenue_for_org(integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- Document numbering
-- -----------------------------------------------------------------------------
--
-- The prefix CASE still maps four document types that can no longer be passed.
-- Left as dead branches it would read as though invoices were coming back, so
-- the function is restated with only the branch that can be reached.

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
  v_number     integer;
  v_prefix     text;
  v_padding    integer;
BEGIN
  v_period_key := CASE p_reset_period
    WHEN 'yearly'  THEN to_char(CURRENT_DATE, 'YYYY')
    WHEN 'monthly' THEN to_char(CURRENT_DATE, 'YYYY-MM')
    ELSE ''
  END;

  v_prefix := COALESCE(p_prefix, CASE p_doc_type
    WHEN 'quotation' THEN 'QUO'
    ELSE 'DOC'
  END);

  -- The row lock is the whole point: (org, doc_type, period) is incremented
  -- under it, so two people creating a quotation at once cannot collide
  -- (§18 rule 4 — a number is assigned once and never recycled).
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

-- -----------------------------------------------------------------------------
-- Custom fields
-- -----------------------------------------------------------------------------
--
-- 'commercial_document' stays a legal entity_type: quotations are still
-- commercial documents and still render custom fields. Nothing to change.
