-- =============================================================================
-- 00025_workflow_identity_and_triggers
--
-- Closes three of the workflow engine gaps recorded in PROJECT-STATUS.md.
--
-- 1. Workflows can now author comments. `comments.author_id` was NOT NULL and a
--    workflow has no human identity, so `add_comment` had to be skipped. Rather
--    than mint a fake user — which would show up in member lists, seat counts
--    and mention pickers — a comment now records *what kind* of author it has.
--
-- 2. Webhook triggers get a token to be addressed by. The workflow id is not
--    usable for this: it is visible throughout the UI and in URLs, and a
--    trigger endpoint is a capability, so it needs a secret that can be rotated
--    without recreating the workflow.
--
-- 3. Schedule triggers get somewhere to record which occurrence last fired, so
--    a poller that runs late does not fire the same slot twice.
-- =============================================================================

-- --- 1. comment authorship ---------------------------------------------------

ALTER TABLE comments
  ALTER COLUMN author_id DROP NOT NULL;

ALTER TABLE comments
  ADD COLUMN author_type text NOT NULL DEFAULT 'user'
    CHECK (author_type IN ('user', 'workflow')),
  ADD COLUMN author_workflow_id uuid REFERENCES workflows(id) ON DELETE SET NULL;

-- The identity has to be internally consistent: a user comment names a user, an
-- automated one does not. Without this, dropping NOT NULL above would let a
-- comment exist with no author of any kind.
ALTER TABLE comments
  ADD CONSTRAINT comments_author_identity CHECK (
    (author_type = 'user' AND author_id IS NOT NULL)
    OR (author_type = 'workflow' AND author_id IS NULL)
  );

-- `author_workflow_id` is attribution only, and is deliberately nullable with
-- ON DELETE SET NULL: deleting a workflow must not delete the comments it
-- wrote, and must not violate the identity constraint either. The comment
-- survives as "Automation" with no link.
COMMENT ON COLUMN comments.author_workflow_id IS
  'Which workflow wrote this comment. Attribution only; cleared if the workflow is deleted.';

-- Re-state the INSERT policies so the rule is visible where it is enforced.
-- `author_id = auth.uid()` already makes an automated comment impossible for a
-- user to insert (NULL = auth.uid() is NULL, not true), but a reader auditing
-- these policies should not have to derive that.
DROP POLICY IF EXISTS "Members write comments" ON comments;
CREATE POLICY "Members write comments" ON comments
  FOR INSERT WITH CHECK (
    organization_id = public.org_id()
    AND author_id = auth.uid()
    AND author_type = 'user'
  );

DROP POLICY IF EXISTS "Portal users write external comments" ON comments;
CREATE POLICY "Portal users write external comments" ON comments
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND author_type = 'user'
    AND is_internal = false
    AND task_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = comments.task_id AND public.portal_can_comment_on_project(t.project_id)
    )
  );

-- --- 2. webhook trigger tokens -----------------------------------------------

-- 00005 gave workflows a plaintext `webhook_token`, minted by a trigger. That
-- token is a bearer credential — anyone holding it can fire the workflow from
-- outside, unauthenticated — and the "Members read workflows" policy let every
-- member of the org read it.
--
-- Column-level REVOKE does not fix this. A table-level GRANT SELECT (which
-- Supabase applies to `authenticated` by default) outranks a column-level
-- revoke, so `REVOKE SELECT (webhook_token)` is silently a no-op. Revoking the
-- table grant and re-granting per column would work, but leaves a trap: every
-- column added by a later migration would be unreadable until someone
-- remembered to grant it.
--
-- So the token is stored the way an API key should be — hashed. Reading the row
-- reveals nothing usable; the plaintext is shown once, when it is minted or
-- rotated. The route hashes what it receives and looks that up.
--
-- Dropping the plaintext column outright is safe here only because no workflow
-- exists yet (verified: 0 rows). The two-step rule in §15 applies to columns
-- with data.

DROP TRIGGER IF EXISTS ensure_webhook_token_trigger ON workflows;
DROP FUNCTION IF EXISTS public.ensure_webhook_token();

-- The CHECK from 00005 names the old column, so it goes with it. Postgres finds
-- the constraint by the column it depends on.
ALTER TABLE workflows DROP COLUMN webhook_token;

ALTER TABLE workflows
  ADD COLUMN webhook_token_hash text UNIQUE,
  ADD CONSTRAINT workflows_webhook_needs_token CHECK (
    trigger_type <> 'webhook' OR webhook_token_hash IS NOT NULL
  );

COMMENT ON COLUMN workflows.webhook_token_hash IS
  'SHA-256 of the trigger token, hex. The plaintext is shown once at mint time and never stored. Compare by hashing the incoming token.';

-- --- 3. schedule bookkeeping -------------------------------------------------

ALTER TABLE workflows
  ADD COLUMN last_scheduled_slot text;

COMMENT ON COLUMN workflows.last_scheduled_slot IS
  'Which occurrence of a schedule last fired, as a slot key. Comparing slots keeps a late poll from firing the same occurrence twice, and stops schedule drift.';

-- The existing idx_workflows_active_trigger leads with organization_id, but the
-- scheduler scans every org at once and so cannot use it.
CREATE INDEX idx_workflows_scheduled
  ON workflows (trigger_type, is_active)
  WHERE trigger_type = 'schedule' AND is_active = true;
