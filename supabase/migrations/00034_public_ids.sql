-- =============================================================================
-- 00034_public_ids
--
-- Every identifier the app puts in front of a person is now a plain 16-digit
-- number. The uuid primary keys stay exactly where they are: `auth.users.id` is
-- issued by Supabase and cannot change, ~47 columns reference it, and RLS is
-- written against uuid throughout. So this adds a second identifier rather than
-- replacing the first — `id` is the internal key nobody outside the database
-- sees, `public_id` is what appears in URLs, exports and the UI.
--
-- Generation is collision-free by construction, not by luck. A single sequence
-- is mapped through a multiplicative permutation:
--
--   public_id = 10^15 + (n * 2654435761 mod 8*10^15)
--
-- 8*10^15 factors as 2^18 * 5^15, and 2654435761 is odd and does not end in 0
-- or 5, so the two are coprime and the map is a bijection over the modulus:
-- distinct sequence values give distinct ids, and the output is scattered
-- rather than sequential, so an id leaks neither ordering nor volume.
--
-- The bounds are chosen so every value satisfies two constraints at once:
--
--   lowest  = 1000000000000000  -> 16 digits
--   highest = 8999999999999999  -> 16 digits, and below 2^53-1
--                                  (9007199254740991)
--
-- The second half of that matters as much as the first. Postgres hands a bigint
-- to PostgREST, which serialises it as a JSON number, and `JSON.parse` in the
-- browser rounds anything past 2^53. A modulus of 9*10^15 would still be 16
-- digits but would put the top of the range beyond that limit, and roughly one
-- id in nine would arrive in the client silently altered. Capping at 8*10^15
-- keeps every id an exact JavaScript integer.
--
-- The multiply is done in `numeric` on purpose: n * 2654435761 overflows bigint
-- once n passes ~3.5e9, and the sequence is allowed to run far beyond that.
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS public.public_id_seq AS bigint START 1;

-- SECURITY DEFINER so the sequence itself can stay unreachable. Reading the
-- raw sequence would tell any signed-in user how many rows the whole platform
-- has created and let them predict the next id; going through the function
-- gives them the one value they are entitled to and nothing else.
CREATE OR REPLACE FUNCTION public.new_public_id()
RETURNS bigint
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 1000000000000000::bigint
       + ((nextval('public.public_id_seq')::numeric * 2654435761)
          % 8000000000000000)::bigint;
$$;

COMMENT ON FUNCTION public.new_public_id() IS
  'Next 16-digit public identifier. Bijective over a shared sequence, so values never collide and never run in order.';

-- The sequence is the generator's private business; the column DEFAULT reaches
-- it through the function, so no end-user role needs it directly.
REVOKE ALL ON SEQUENCE public.public_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.public_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.public_id_seq FROM authenticated;

REVOKE ALL ON FUNCTION public.new_public_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.new_public_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.new_public_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.new_public_id() TO service_role;

-- -----------------------------------------------------------------------------
-- Apply to every table whose id the app generates and then shows
-- -----------------------------------------------------------------------------
--
-- Backfill first, then NOT NULL, then the unique index: doing it in that order
-- means the column is never briefly nullable-and-indexed on a live table.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects', 'tasks', 'subtasks', 'documents',
    'workflows', 'sprints', 'contacts', 'commercial_documents'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS public_id bigint', t);
    EXECUTE format(
      'UPDATE public.%I SET public_id = public.new_public_id() WHERE public_id IS NULL', t);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN public_id SET DEFAULT public.new_public_id()', t);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN public_id SET NOT NULL', t);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_%s_public_id ON public.%I(public_id)', t, t);
    -- 16 digits and JS-safe, no exceptions: a row that arrives with its own
    -- value must be addressable by the same URL grammar as every other row, and
    -- must survive the trip through JSON intact.
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_public_id_16_digits');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (public_id BETWEEN 1000000000000000 AND 8999999999999999)',
      t, t || '_public_id_16_digits');
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Project key — the editable front identifier
-- -----------------------------------------------------------------------------
--
-- Distinct from public_id in every way that matters: the key is chosen by a
-- person, is short enough to read inside a task reference (VEK-241), and can be
-- changed later. public_id is generated, opaque and permanent. Unique per
-- organization rather than globally, because two tenants naming their project
-- "OPS" is not a conflict.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS key text;

-- Backfill mirrors the old projectKey() helper the UI used to derive on the
-- fly — first three characters of the name — but has to satisfy the CHECK
-- below, which the helper never had to. Leading digits are dropped (a key must
-- start with a letter) and anything left too short falls back to PRJ, so a
-- project called "3M" or "Q" still gets a legal key. Collisions inside one
-- organization take a numeric suffix, with the oldest project keeping the bare
-- key so existing task references stay readable.
WITH derived AS (
  SELECT
    p.id,
    CASE
      WHEN length(substring(
             regexp_replace(upper(regexp_replace(p.name, '[^A-Za-z0-9]+', '', 'g')), '^[0-9]+', '')
             FROM 1 FOR 3)) >= 2
      THEN substring(
             regexp_replace(upper(regexp_replace(p.name, '[^A-Za-z0-9]+', '', 'g')), '^[0-9]+', '')
             FROM 1 FOR 3)
      ELSE 'PRJ'
    END AS base
  FROM public.projects p
  WHERE p.key IS NULL
),
ranked AS (
  SELECT
    d.id,
    d.base,
    row_number() OVER (
      PARTITION BY p.organization_id, d.base
      ORDER BY p.created_at, p.id
    ) AS rank
  FROM derived d
  JOIN public.projects p ON p.id = d.id
)
UPDATE public.projects p
SET key = CASE WHEN r.rank = 1 THEN r.base ELSE r.base || r.rank::text END
FROM ranked r
WHERE p.id = r.id;

ALTER TABLE public.projects
  ALTER COLUMN key SET NOT NULL;

-- 2-10 characters, uppercase alphanumeric, must start with a letter. Narrow on
-- purpose: the key is concatenated into "KEY-42", so a key containing a hyphen
-- or a digit-only key would make that reference ambiguous to read and to parse.
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_key_format;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_key_format CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_key_org
  ON public.projects(organization_id, key);

COMMENT ON COLUMN public.projects.key IS
  'Human-facing project key used in task references (VEK-241). Editable, unique within the organization.';
COMMENT ON COLUMN public.projects.public_id IS
  'Generated 16-digit identifier used in URLs and exports. Permanent; not the primary key.';
