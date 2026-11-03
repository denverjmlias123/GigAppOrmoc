-- Migration: Multi-Category Support for Gigs
-- Allows gig posters to specify 1 Primary category + up to 2 Secondary categories (max 3 total).
-- Preserves backwards compatibility for existing gigs, indexes, and queries.

-- 1. Add secondary_category_ids array to public.gigs
ALTER TABLE public.gigs
  ADD COLUMN IF NOT EXISTS secondary_category_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_gigs_secondary_categories ON public.gigs USING gin (secondary_category_ids);

-- 2. Update create_draft_gig to accept secondary_category_ids
-- Drop first because CREATE OR REPLACE cannot change return type or OUT params
DROP FUNCTION IF EXISTS public.create_draft_gig(text, text, text, integer, integer, text, text, timestamptz, timestamptz, uuid, text, uuid[]);
CREATE OR REPLACE FUNCTION public.create_draft_gig(
  p_title text,
  p_description text,
  p_requirements text,
  p_price_min integer,
  p_price_max integer,
  p_work_type text,
  p_area text,
  p_application_deadline timestamptz,
  p_deadline timestamptz,
  p_category_id uuid DEFAULT NULL,
  p_category_name text DEFAULT NULL,
  p_secondary_category_ids uuid[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_resolved_category_id uuid;
  v_clean_secondary uuid[] := '{}';
  v_gig_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active.';
  END IF;

  IF COALESCE(v_profile.active_mode, '') <> 'hire' THEN
    RAISE EXCEPTION 'You must be in Hire Someone mode to create a gig.';
  END IF;

  -- Resolve primary category: p_category_id OR p_category_name
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

  -- Validate & clean secondary categories (max 2 distinct active categories, not matching primary)
  IF p_secondary_category_ids IS NOT NULL AND array_length(p_secondary_category_ids, 1) > 0 THEN
    SELECT COALESCE(array_agg(sub.id), '{}')
    INTO v_clean_secondary
    FROM (
      SELECT DISTINCT c.id
      FROM unnest(p_secondary_category_ids) sec_id
      JOIN public.categories c ON c.id = sec_id AND c.is_active = true
      WHERE sec_id <> v_resolved_category_id
      LIMIT 2
    ) sub;
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
    secondary_category_ids,
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
    v_clean_secondary,
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
      'secondary_category_ids', v_clean_secondary,
      'used_category_name', (p_category_id IS NULL AND p_category_name IS NOT NULL)
    )
  );

  RETURN v_gig_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_draft_gig(text, text, text, integer, integer, text, text, timestamptz, timestamptz, uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_gig(text, text, text, integer, integer, text, text, timestamptz, timestamptz, uuid, text, uuid[]) TO authenticated;

-- 3. Update get_available_gigs to search both primary and secondary categories
-- Drop first because CREATE OR REPLACE cannot change return type or OUT params
DROP FUNCTION IF EXISTS public.get_available_gigs(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.get_available_gigs(
    p_category_id UUID DEFAULT NULL,
    p_work_type TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    client_id UUID,
    title TEXT,
    price_min INTEGER,
    price_max INTEGER,
    work_type TEXT,
    area TEXT,
    application_deadline TIMESTAMPTZ,
    deadline TIMESTAMPTZ,
    status TEXT,
    created_at TIMESTAMPTZ,
    category_name TEXT,
    client_display_name TEXT,
    client_avatar_path TEXT,
    client_rating_avg NUMERIC(3,2),
    client_completed_gigs INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
BEGIN
    v_caller_id := auth.uid();

    RETURN QUERY
    SELECT
        g.id,
        g.client_id,
        g.title,
        g.price_min,
        g.price_max,
        g.work_type,
        g.area,
        g.application_deadline,
        g.deadline,
        g.status,
        g.created_at,
        c.name AS category_name,
        p.display_name AS client_display_name,
        p.avatar_path AS client_avatar_path,
        p.client_rating_avg,
        p.client_completed_gigs
    FROM public.gigs g
    JOIN public.categories c ON c.id = g.category_id
    JOIN public.profiles p ON p.id = g.client_id
    WHERE g.status = 'open'
      AND g.application_deadline > now()
      -- Own-content rule: caller's own gigs are strictly excluded
      AND (v_caller_id IS NULL OR g.client_id <> v_caller_id)
      -- Multi-category match: match primary OR any secondary category
      AND (
          p_category_id IS NULL
          OR g.category_id = p_category_id
          OR p_category_id = ANY(g.secondary_category_ids)
      )
      AND (p_work_type IS NULL OR g.work_type = p_work_type)
      AND (
          p_search IS NULL OR
          g.title ILIKE '%' || p_search || '%' OR
          g.description ILIKE '%' || p_search || '%' OR
          c.name ILIKE '%' || p_search || '%'
      )
    ORDER BY g.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_gigs(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_gigs(UUID, TEXT, TEXT) TO authenticated;

-- 4. Update admin_merge_categories to also update secondary_category_ids
-- Drop first because CREATE OR REPLACE cannot change return type or OUT params
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

  SELECT * INTO v_from_cat FROM public.categories WHERE id = p_from;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source category not found.';
  END IF;

  SELECT * INTO v_into_cat FROM public.categories WHERE id = p_into;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target category not found.';
  END IF;

  -- Move gigs primary category
  UPDATE public.gigs
  SET category_id = p_into, updated_at = now()
  WHERE category_id = p_from;
  GET DIAGNOSTICS v_moved_gigs = ROW_COUNT;

  -- Move gigs secondary categories
  UPDATE public.gigs
  SET secondary_category_ids = array_replace(secondary_category_ids, p_from, p_into)
  WHERE p_from = ANY(secondary_category_ids);

  -- Move hiring interests
  UPDATE public.profile_hiring_interests
  SET category_id = p_into
  WHERE category_id = p_from
    AND NOT EXISTS (
      SELECT 1 FROM public.profile_hiring_interests existing
      WHERE existing.profile_id = profile_hiring_interests.profile_id
        AND existing.category_id = p_into
    );
  DELETE FROM public.profile_hiring_interests WHERE category_id = p_from;

  -- Move skills
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
