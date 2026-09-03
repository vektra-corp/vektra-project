-- =============================================================================
-- 00003_collaboration
--
-- Documents, comments, attachments. claude.md §6.3.
-- Documents come first because comments can hang off them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Documents
-- -----------------------------------------------------------------------------

CREATE TABLE documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (length(trim(title)) > 0),
  content         jsonb,              -- Tiptap JSON, sanitized before storage (§13.1)
  version         integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'archived')),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_documents_org ON documents(organization_id);
CREATE INDEX idx_documents_title ON documents USING gin (title gin_trgm_ops);

CREATE TABLE document_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  content         jsonb NOT NULL,
  edited_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE INDEX idx_document_versions_document ON document_versions(document_id, version DESC);
CREATE INDEX idx_document_versions_org ON document_versions(organization_id);

-- Snapshot the previous content whenever a document's body changes, so history
-- is captured by the database rather than depending on every caller to remember.
-- SECURITY DEFINER: document_versions is written only by this trigger, and
-- INSERT on it is revoked from end-user roles (see 00009).
CREATE OR REPLACE FUNCTION public.snapshot_document_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.content IS DISTINCT FROM NEW.content AND OLD.content IS NOT NULL THEN
    INSERT INTO document_versions (document_id, organization_id, version, content, edited_by)
    VALUES (OLD.id, OLD.organization_id, OLD.version, OLD.content, auth.uid())
    ON CONFLICT (document_id, version) DO NOTHING;

    NEW.version = OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER snapshot_document_version_trigger
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_document_version();

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------

CREATE TABLE comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id      uuid REFERENCES subtasks(id) ON DELETE CASCADE,
  document_id     uuid REFERENCES documents(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES comments(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body            jsonb NOT NULL,
  -- Internal comments are hidden from portal users (§7).
  is_internal     boolean NOT NULL DEFAULT false,
  is_edited       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (task_id IS NOT NULL)::int +
    (subtask_id IS NOT NULL)::int +
    (document_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX idx_comments_task ON comments(task_id, created_at) WHERE task_id IS NOT NULL;
CREATE INDEX idx_comments_subtask ON comments(subtask_id, created_at) WHERE subtask_id IS NOT NULL;
CREATE INDEX idx_comments_document ON comments(document_id, created_at) WHERE document_id IS NOT NULL;
CREATE INDEX idx_comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_comments_org ON comments(organization_id);
CREATE INDEX idx_comments_author ON comments(author_id);

-- Replies are one level deep: a reply cannot itself be replied to.
-- SECURITY DEFINER so the parent lookup is not filtered by the caller's own
-- comment visibility, which would let the depth rule be bypassed.
CREATE OR REPLACE FUNCTION public.check_comment_depth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_has_parent boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parent_id IS NOT NULL INTO parent_has_parent
  FROM comments WHERE id = NEW.parent_id;

  IF parent_has_parent THEN
    RAISE EXCEPTION 'Comment replies are limited to one level'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER check_comment_depth_trigger
  BEFORE INSERT OR UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION public.check_comment_depth();

-- Mark a comment as edited when its body changes after creation.
CREATE OR REPLACE FUNCTION public.mark_comment_edited()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.body IS DISTINCT FROM NEW.body THEN
    NEW.is_edited = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mark_comment_edited_trigger
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION public.mark_comment_edited();

-- -----------------------------------------------------------------------------
-- Attachments
--
-- storage_path always starts with the org id (§13.9), so a leaked signed URL
-- still cannot be walked into another tenant's files.
-- -----------------------------------------------------------------------------

CREATE TABLE attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id      uuid REFERENCES subtasks(id) ON DELETE CASCADE,
  comment_id      uuid REFERENCES comments(id) ON DELETE CASCADE,
  document_id     uuid REFERENCES documents(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  file_size       bigint NOT NULL CHECK (file_size >= 0),
  mime_type       text NOT NULL,
  storage_path    text NOT NULL UNIQUE,
  uploaded_by     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (task_id IS NOT NULL)::int +
    (subtask_id IS NOT NULL)::int +
    (comment_id IS NOT NULL)::int +
    (document_id IS NOT NULL)::int = 1
  ),
  CHECK (storage_path LIKE organization_id::text || '/%')
);

CREATE INDEX idx_attachments_task ON attachments(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_attachments_subtask ON attachments(subtask_id) WHERE subtask_id IS NOT NULL;
CREATE INDEX idx_attachments_comment ON attachments(comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX idx_attachments_document ON attachments(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX idx_attachments_org ON attachments(organization_id);

SELECT public.apply_updated_at_triggers();
