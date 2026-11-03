-- Migration: 20261011000018_post_gig_category_unlocked.sql
-- Milestone 18: Post Gig Category Is Not Locked (Suggest First, Create Last)
-- Strictly adheres to AGENTS.md, docs/MILESTONES.md (M18), and docs/PROFILE_AND_LOOP_V5_1.md Sections 2 & 2A.
-- Zero seed categories. All writes go through RLS / SECURITY DEFINER RPCs.

-- 1. Enable pg_trgm for fuzzy similarity matching on categories and gigs
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Ensure categories has source, created_by, unique lower(trim(name)) index, and trigram index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'source'
  ) THEN
    ALTER TABLE public.categories
      ADD COLUMN source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'user'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.categories
      ADD COLUMN created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_lower_name
  ON public.categories (lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_categories_trgm_name
  ON public.categories USING gin (lower(name) gin_trgm_ops);

-- RLS on categories: authenticated users can read active categories or categories they created.
-- Direct INSERT / UPDATE / DELETE remain strictly revoked.
DROP POLICY IF EXISTS "Anyone can view active categories" ON public.categories;
DROP POLICY IF EXISTS "Authenticated users can view active categories" ON public.categories;
DROP POLICY IF EXISTS "Authenticated users can view active or own categories" ON public.categories;
CREATE POLICY "Authenticated users can view active or own categories"
  ON public.categories
  FOR SELECT
  TO authenticated
  USING (is_active = true OR created_by = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon, authenticated, PUBLIC;

-- 3. Helper: normalize_category_stem(p_text text)
-- Normalizes case, collapses spaces, and strips simple plural suffixes ('es'/'s' on words >= 4 chars)
-- so singular/plural variants ("Phone repair" vs "Phone repairs") match cleanly.
DROP FUNCTION IF EXISTS public.normalize_category_stem(text);
CREATE OR REPLACE FUNCTION public.normalize_category_stem(
  p_text text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean text;
  v_words text[];
  v_word text;
  v_out text[] := ARRAY[]::text[];
BEGIN
  v_clean := lower(regexp_replace(trim(COALESCE(p_text, '')), '\s+', ' ', 'g'));
  IF v_clean = '' THEN
    RETURN '';
  END IF;

  v_words := string_to_array(v_clean, ' ');
  FOREACH v_word IN ARRAY v_words
  LOOP
    IF char_length(v_word) >= 5 AND right(v_word, 3) = 'ies' THEN
      v_word := left(v_word, char_length(v_word) - 3) || 'y';
    ELSIF char_length(v_word) >= 5 AND right(v_word, 2) IN ('es') AND right(v_word, 3) IN ('ses', 'xes', 'zes', 'ches', 'shes') THEN
      v_word := left(v_word, char_length(v_word) - 2);
    ELSIF char_length(v_word) >= 4 AND right(v_word, 1) = 's' AND right(v_word, 2) <> 'ss' THEN
      v_word := left(v_word, char_length(v_word) - 1);
    END IF;
    v_out := array_append(v_out, v_word);
  END LOOP;

  RETURN array_to_string(v_out, ' ');
END;
$$;

-- 4. RPC: get_or_create_category(p_name text) RETURNS uuid
-- Section 2 & 2A:
-- - Authenticated only (caller from auth.uid())
-- - Normalizes (trim, collapse spaces), 3-40 chars
-- - Allowed chars: letters, numbers, space, and & - + / only
-- - Rejects URLs, emails, phone numbers, profanity, all-caps shouting, and pure numbers
-- - Case-insensitive + stem + pg_trgm similarity (>= 0.7) dedupe: returns existing category ID instead of creating near-duplicates
-- - Limits for genuinely new categories: max 3 per 24h per user, max 10 total per user; rate limit + audit_events
DROP FUNCTION IF EXISTS public.get_or_create_category(text);
CREATE OR REPLACE FUNCTION public.get_or_create_category(
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_norm text;
  v_stem text;
  v_existing_id uuid;
  v_recent_24h integer;
  v_total_user_cats integer;
  v_slug text;
  v_new_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active.';
  END IF;

  -- Normalize whitespace
  v_norm := regexp_replace(trim(COALESCE(p_name, '')), '\s+', ' ', 'g');

  -- Length 3-40 chars
  IF char_length(v_norm) < 3 OR char_length(v_norm) > 40 THEN
    RAISE EXCEPTION 'Category name must be between 3 and 40 characters.';
  END IF;

  -- Reject emails and URLs before character check so error message is specific
  IF position('@' in v_norm) > 0 THEN
    RAISE EXCEPTION 'Category name cannot contain an email address.';
  END IF;

  IF v_norm ~* '(https?://|www\.|\.[a-z]{2,4}/|\.(com|net|org|ph|io)\y)' THEN
    RAISE EXCEPTION 'Category name cannot contain a website or URL.';
  END IF;

  -- Reject phone numbers (7+ digits)
  IF char_length(regexp_replace(v_norm, '[^0-9]', '', 'g')) >= 7 THEN
    RAISE EXCEPTION 'Category name cannot contain a phone number.';
  END IF;

  -- Reject names that are only numbers/symbols (must have at least 2 letters)
  IF char_length(regexp_replace(v_norm, '[^A-Za-z]', '', 'g')) < 2 THEN
    RAISE EXCEPTION 'Category name must include letters and cannot be just a number.';
  END IF;

  -- Allowed characters: letters, numbers, space, and & - + /
  IF v_norm !~ '^[A-Za-z0-9 &+\-/]+$' THEN
    RAISE EXCEPTION 'Category name may only contain letters, numbers, spaces, and & - + /.';
  END IF;

  -- Reject all-caps shouting (when 4+ letters and all letters are uppercase)
  IF char_length(regexp_replace(v_norm, '[^A-Za-z]', '', 'g')) >= 4
     AND v_norm = upper(v_norm)
     AND v_norm <> lower(v_norm) THEN
    RAISE EXCEPTION 'Please use normal capitalization instead of all caps.';
  END IF;

  -- Reject profanity / abusive terms
  IF v_norm ~* '\y(fuck|shit|bitch|asshole|puta|putangina|gago|tarantado|ulol|bobo|scam|scammer|porn|sex|shabu)\y' THEN
    RAISE EXCEPTION 'Category name contains inappropriate language.';
  END IF;

  -- 1. Exact case-insensitive match (admin or user)
  SELECT c.id INTO v_existing_id
  FROM public.categories c
  WHERE lower(trim(c.name)) = lower(v_norm)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- 2. Singular/plural stem match or high trigram similarity match (Section 2A rule 4)
  v_stem := public.normalize_category_stem(v_norm);

  SELECT c.id INTO v_existing_id
  FROM public.categories c
  WHERE c.is_active = true
    AND (
      public.normalize_category_stem(c.name) = v_stem
      OR similarity(lower(c.name), lower(v_norm)) >= 0.68
      OR similarity(public.normalize_category_stem(c.name), v_stem) >= 0.68
    )
  ORDER BY
    (public.normalize_category_stem(c.name) = v_stem) DESC,
    similarity(public.normalize_category_stem(c.name), v_stem) DESC,
    (c.source = 'admin') DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- 3. Quota & Rate Limit checks for creating a genuinely NEW category
  SELECT count(*) INTO v_recent_24h
  FROM public.categories c
  WHERE c.created_by = v_user_id
    AND c.source = 'user'
    AND c.created_at > now() - interval '24 hours';

  IF v_recent_24h >= 3 THEN
    RAISE EXCEPTION 'You can create at most 3 new categories per 24 hours. Please pick an existing category.';
  END IF;

  SELECT count(*) INTO v_total_user_cats
  FROM public.categories c
  WHERE c.created_by = v_user_id
    AND c.source = 'user';

  IF v_total_user_cats >= 10 THEN
    RAISE EXCEPTION 'You have reached the maximum of 10 custom categories per account. Please pick an existing category.';
  END IF;

  -- Generate unique slug
  v_slug := regexp_replace(lower(v_norm), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN
    v_slug := 'category';
  END IF;
  IF EXISTS (SELECT 1 FROM public.categories WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  END IF;

  INSERT INTO public.categories (name, slug, is_active, source, created_by)
  VALUES (v_norm, v_slug, true, 'user', v_user_id)
  RETURNING id INTO v_new_id;

  INSERT INTO public.rate_limit_events (user_id, action)
  VALUES (v_user_id, 'create_category');

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'create_category',
    'categories',
    v_new_id,
    jsonb_build_object('name', v_norm, 'slug', v_slug, 'source', 'user')
  );

  RETURN v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_category(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_category(text) TO authenticated;

-- 5. RPC: suggest_categories_for_gig(p_title text, p_description text)
-- Section 2A rule 1 (Source 1 — always works, no AI needed):
-- Fuzzy search with pg_trgm similarity and keyword match over active category names
-- plus the categories of similar open/completed gigs. Returns top 3 existing categories.
DROP FUNCTION IF EXISTS public.suggest_categories_for_gig(text, text);
CREATE OR REPLACE FUNCTION public.suggest_categories_for_gig(
  p_title text,
  p_description text DEFAULT ''
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  similarity_score real,
  match_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_query text;
  v_stem text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  v_query := lower(trim(COALESCE(p_title, '') || ' ' || COALESCE(p_description, '')));
  IF char_length(v_query) < 2 THEN
    RETURN;
  END IF;

  v_stem := public.normalize_category_stem(v_query);

  RETURN QUERY
  WITH scored AS (
    SELECT
      c.id,
      c.name,
      c.slug,
      GREATEST(
        similarity(lower(c.name), lower(trim(COALESCE(p_title, '')))),
        word_similarity(lower(c.name), v_query),
        similarity(public.normalize_category_stem(c.name), v_stem),
        COALESCE((
          SELECT max(similarity(lower(g.title), lower(trim(COALESCE(p_title, ''))))) * 0.85
          FROM public.gigs g
          WHERE g.category_id = c.id
            AND g.status IN ('open', 'in_progress', 'completed')
        ), 0::real)
      )::real AS score,
      CASE
        WHEN word_similarity(lower(c.name), v_query) >= 0.45 THEN 'Matches keywords in your gig'
        ELSE 'Similar to existing gigs in Ormoc'
      END AS reason
    FROM public.categories c
    WHERE c.is_active = true
  )
  SELECT
    s.id,
    s.name,
    s.slug,
    s.score AS similarity_score,
    s.reason AS match_reason
  FROM scored s
  WHERE s.score >= 0.15
  ORDER BY s.score DESC, s.name ASC
  LIMIT 3;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.suggest_categories_for_gig(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_categories_for_gig(text, text) TO authenticated;

-- 6. RPC: find_similar_categories(p_query text)
-- Section 2A rule 3: Powers "Did you mean...?" while typing a new category name.
DROP FUNCTION IF EXISTS public.find_similar_categories(text);
CREATE OR REPLACE FUNCTION public.find_similar_categories(
  p_query text
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  similarity_score real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_norm text;
  v_stem text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  v_norm := lower(regexp_replace(trim(COALESCE(p_query, '')), '\s+', ' ', 'g'));
  IF char_length(v_norm) < 2 THEN
    RETURN;
  END IF;

  v_stem := public.normalize_category_stem(v_norm);

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.slug,
    GREATEST(
      similarity(lower(c.name), v_norm),
      similarity(public.normalize_category_stem(c.name), v_stem),
      word_similarity(v_norm, lower(c.name)) * 0.85
    )::real AS similarity_score
  FROM public.categories c
  WHERE c.is_active = true
    AND (
      public.normalize_category_stem(c.name) = v_stem
      OR similarity(lower(c.name), v_norm) >= 0.3
      OR similarity(public.normalize_category_stem(c.name), v_stem) >= 0.3
      OR lower(c.name) LIKE '%' || v_norm || '%'
    )
  ORDER BY
    (public.normalize_category_stem(c.name) = v_stem) DESC,
    GREATEST(
      similarity(lower(c.name), v_norm),
      similarity(public.normalize_category_stem(c.name), v_stem)
    ) DESC,
    c.name ASC
  LIMIT 5;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_similar_categories(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_similar_categories(text) TO authenticated;

-- 7. RPC: get_browse_categories()
-- Section 2A rule 7 (Popularity guard):
-- Browse filter chips list active admin categories plus active user categories used by >= 2 different posters.
DROP FUNCTION IF EXISTS public.get_browse_categories();
CREATE OR REPLACE FUNCTION public.get_browse_categories()
RETURNS SETOF public.categories
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT c.*
  FROM public.categories c
  WHERE c.is_active = true
    AND (
      c.source = 'admin'
      OR (
        SELECT count(DISTINCT g.client_id)
        FROM public.gigs g
        WHERE g.category_id = c.id
          AND g.status IN ('open', 'in_progress', 'completed')
      ) >= 2
    )
  ORDER BY c.name ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_browse_categories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_browse_categories() TO authenticated;

-- 8. RPC: create_draft_gig
-- Accepts p_category_id OR p_category_name (calls get_or_create_category in the same transaction).
DROP FUNCTION IF EXISTS public.create_draft_gig(text, text, text, integer, integer, text, text, timestamptz, timestamptz, uuid, text);
CREATE OR REPLACE FUNCTION public.create_draft_gig(
  p_title text,
  p_description text,
  p_requirements text DEFAULT '',
  p_price_min integer DEFAULT 10000,
  p_price_max integer DEFAULT 10000,
  p_work_type text DEFAULT 'remote',
  p_area text DEFAULT '',
  p_application_deadline timestamptz DEFAULT (now() + interval '7 days'),
  p_deadline timestamptz DEFAULT (now() + interval '14 days'),
  p_category_id uuid DEFAULT NULL,
  p_category_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_resolved_category_id uuid;
  v_gig_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active.';
  END IF;

  IF COALESCE(v_profile.active_mode, '') <> 'hire' THEN
    RAISE EXCEPTION 'You must be in Hire Someone mode to create a gig.';
  END IF;

  -- Resolve category: p_category_id OR p_category_name
  IF p_category_id IS NOT NULL THEN
    SELECT c.id INTO v_resolved_category_id
    FROM public.categories c
    WHERE c.id = p_category_id AND c.is_active = true;

    IF v_resolved_category_id IS NULL THEN
      RAISE EXCEPTION 'Selected category was not found or is inactive.';
    END IF;
  ELSIF p_category_name IS NOT NULL AND trim(p_category_name) <> '' THEN
    v_resolved_category_id := public.get_or_create_category(p_category_name);
  ELSE
    RAISE EXCEPTION 'Please select an existing category or enter a new category name.';
  END IF;

  -- Validate basic draft bounds
  IF char_length(trim(COALESCE(p_title, ''))) < 5 OR char_length(trim(COALESCE(p_title, ''))) > 80 THEN
    RAISE EXCEPTION 'Gig title must be between 5 and 80 characters.';
  END IF;

  IF char_length(trim(COALESCE(p_description, ''))) < 30 OR char_length(trim(COALESCE(p_description, ''))) > 2000 THEN
    RAISE EXCEPTION 'Gig description must be between 30 and 2000 characters.';
  END IF;

  IF p_price_min < 10000 THEN
    RAISE EXCEPTION 'Minimum budget must be at least ₱100.00 (10000 centavos).';
  END IF;

  IF p_price_max < p_price_min THEN
    RAISE EXCEPTION 'Maximum budget cannot be less than minimum budget.';
  END IF;

  IF p_work_type NOT IN ('remote', 'face_to_face', 'hybrid') THEN
    RAISE EXCEPTION 'Invalid work type.';
  END IF;

  INSERT INTO public.gigs (
    client_id,
    title,
    description,
    requirements,
    category_id,
    price_min,
    price_max,
    work_type,
    area,
    application_deadline,
    deadline,
    status
  ) VALUES (
    v_user_id,
    trim(p_title),
    trim(p_description),
    trim(COALESCE(p_requirements, '')),
    v_resolved_category_id,
    p_price_min,
    p_price_max,
    p_work_type,
    trim(COALESCE(p_area, '')),
    p_application_deadline,
    p_deadline,
    'draft'
  )
  RETURNING id INTO v_gig_id;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'create_draft_gig',
    'gigs',
    v_gig_id,
    jsonb_build_object(
      'category_id', v_resolved_category_id,
      'used_category_name', (p_category_id IS NULL AND p_category_name IS NOT NULL)
    )
  );

  RETURN v_gig_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_draft_gig(text, text, text, integer, integer, text, text, timestamptz, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_gig(text, text, text, integer, integer, text, text, timestamptz, timestamptz, uuid, text) TO authenticated;

-- 9. RPC: admin_merge_categories(p_from uuid, p_into uuid)
-- Section 2A rule 6: Admin only, audited. Moves gigs, hiring interests, and skills to p_into and deactivates p_from.
DROP FUNCTION IF EXISTS public.admin_merge_categories(uuid, uuid);
CREATE OR REPLACE FUNCTION public.admin_merge_categories(
  p_from uuid,
  p_into uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_from_cat record;
  v_into_cat record;
  v_moved_gigs integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'Access denied. Only platform administrators can merge categories.';
  END IF;

  IF p_from IS NULL OR p_into IS NULL OR p_from = p_into THEN
    RAISE EXCEPTION 'Source and target categories must be two different valid categories.';
  END IF;

  SELECT * INTO v_from_cat FROM public.categories WHERE id = p_from FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source category not found.';
  END IF;

  SELECT * INTO v_into_cat FROM public.categories WHERE id = p_into FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target category not found.';
  END IF;

  -- Move gigs from p_from to p_into
  WITH updated AS (
    UPDATE public.gigs
    SET category_id = p_into,
        updated_at = now()
    WHERE category_id = p_from
    RETURNING id
  )
  SELECT count(*)::integer INTO v_moved_gigs FROM updated;

  -- Move hiring interests (avoiding duplicate primary key)
  INSERT INTO public.profile_hiring_interests (profile_id, category_id)
  SELECT profile_id, p_into
  FROM public.profile_hiring_interests
  WHERE category_id = p_from
  ON CONFLICT (profile_id, category_id) DO NOTHING;

  DELETE FROM public.profile_hiring_interests
  WHERE category_id = p_from;

  -- Move skills referencing source category
  UPDATE public.skills
  SET category_id = p_into
  WHERE category_id = p_from;

  -- Deactivate source category and ensure target category is active
  UPDATE public.categories
  SET is_active = false
  WHERE id = p_from;

  UPDATE public.categories
  SET is_active = true
  WHERE id = p_into;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'admin_merge_categories',
    'categories',
    p_into,
    jsonb_build_object(
      'from_category_id', p_from,
      'from_category_name', v_from_cat.name,
      'into_category_id', p_into,
      'into_category_name', v_into_cat.name,
      'moved_gigs_count', v_moved_gigs
    )
  );

  RETURN jsonb_build_object(
    'from_category_id', p_from,
    'into_category_id', p_into,
    'moved_gigs_count', v_moved_gigs
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_merge_categories(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_merge_categories(uuid, uuid) TO authenticated;
