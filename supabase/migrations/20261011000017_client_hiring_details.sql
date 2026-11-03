-- Migration: 20261011000017_client_hiring_details.sql
-- Milestone 17: Client Hiring Details (Not Skills)
-- Strictly adheres to AGENTS.md, docs/MILESTONES.md (M17), and docs/PROFILE_AND_LOOP_V5_1.md Section 3.
-- No seed data. All writes go through RLS / SECURITY DEFINER RPCs.

-- 1. Expand profiles_client_type_chk to include 'other' (Individual / Small business / Organization or school / Other)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_client_type_chk;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_client_type_chk CHECK (
    client_type IS NULL OR client_type IN ('individual', 'business', 'organization', 'other')
  );

-- 2. Allow user-created custom categories when the categories table is empty or a client adds a new hiring interest
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

DROP POLICY IF EXISTS "Anyone can view active categories" ON public.categories;
DROP POLICY IF EXISTS "Authenticated users can view active categories" ON public.categories;
DROP POLICY IF EXISTS "Authenticated users can view active or own categories" ON public.categories;
CREATE POLICY "Authenticated users can view active or own categories"
  ON public.categories
  FOR SELECT
  TO authenticated
  USING (is_active = true OR created_by = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon, authenticated, PUBLIC;

-- 3. Lock down direct client writes on public.profile_skills so skills can ONLY be mutated via mode-checked RPCs
DROP POLICY IF EXISTS "Users can insert their own profile skills" ON public.profile_skills;
DROP POLICY IF EXISTS "Users can delete their own profile skills" ON public.profile_skills;
DROP POLICY IF EXISTS "Users can manage own profile skills" ON public.profile_skills;
REVOKE INSERT, UPDATE, DELETE ON public.profile_skills FROM anon, authenticated, PUBLIC;

-- 4. Update add_profile_skills to reject callers in 'hire' mode (Skills are strictly for Freelancer mode)
DROP FUNCTION IF EXISTS public.add_profile_skills CASCADE;
DROP FUNCTION IF EXISTS public.add_profile_skills(uuid[], text[]) CASCADE;
CREATE OR REPLACE FUNCTION public.add_profile_skills(
  p_skill_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_custom_names text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE (
  out_skill_id uuid,
  out_skill_name text,
  out_is_active boolean,
  out_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_iter_skill_id uuid;
  v_custom_name text;
  v_trimmed text;
  v_current_skills_count integer;
  v_existing_skill_id uuid;
  v_recent_calls integer;
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

  -- Enforce Freelancer mode: clients in 'hire' mode cannot add skills
  IF COALESCE(v_profile.active_mode, '') <> 'find_work' THEN
    RAISE EXCEPTION 'Skills can only be added in Find Work (Freelancer) mode.';
  END IF;

  SELECT count(*) INTO v_recent_calls
  FROM public.rate_limit_events
  WHERE user_id = v_user_id
    AND action = 'add_profile_skills'
    AND created_at > now() - interval '1 hour';

  IF v_recent_calls >= 15 THEN
    RAISE EXCEPTION 'Rate limit exceeded for adding skills. Please try again later.';
  END IF;

  IF array_length(p_custom_names, 1) > 10 THEN
    RAISE EXCEPTION 'You may add at most 10 custom skills per request.';
  END IF;

  SELECT count(*) INTO v_current_skills_count
  FROM public.profile_skills
  WHERE profile_id = v_user_id;

  -- 1. Process existing catalog skill IDs
  IF p_skill_ids IS NOT NULL AND array_length(p_skill_ids, 1) > 0 THEN
    FOREACH v_iter_skill_id IN ARRAY p_skill_ids
    LOOP
      IF v_iter_skill_id IS NOT NULL THEN
        SELECT count(*) INTO v_current_skills_count
        FROM public.profile_skills
        WHERE profile_id = v_user_id;

        IF v_current_skills_count >= 15 AND NOT EXISTS (
          SELECT 1 FROM public.profile_skills
          WHERE profile_id = v_user_id AND skill_id = v_iter_skill_id
        ) THEN
          RAISE EXCEPTION 'Maximum limit of 15 skills per profile reached.';
        END IF;

        IF EXISTS (
          SELECT 1 FROM public.skills s
          WHERE s.id = v_iter_skill_id AND (s.is_active = true OR s.created_by = v_user_id)
        ) THEN
          INSERT INTO public.profile_skills (profile_id, skill_id)
          VALUES (v_user_id, v_iter_skill_id)
          ON CONFLICT (profile_id, skill_id) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 2. Process custom skill names
  IF p_custom_names IS NOT NULL AND array_length(p_custom_names, 1) > 0 THEN
    FOREACH v_custom_name IN ARRAY p_custom_names
    LOOP
      v_trimmed := trim(v_custom_name);
      IF v_trimmed IS NOT NULL AND v_trimmed <> '' THEN
        IF char_length(v_trimmed) < 2 OR char_length(v_trimmed) > 40 THEN
          RAISE EXCEPTION 'Custom skill name must be between 2 and 40 characters: %', v_trimmed;
        END IF;

        SELECT count(*) INTO v_current_skills_count
        FROM public.profile_skills
        WHERE profile_id = v_user_id;

        SELECT s.id INTO v_existing_skill_id
        FROM public.skills s
        WHERE lower(trim(s.name)) = lower(v_trimmed);

        IF v_existing_skill_id IS NOT NULL THEN
          IF v_current_skills_count >= 15 AND NOT EXISTS (
            SELECT 1 FROM public.profile_skills
            WHERE profile_id = v_user_id AND skill_id = v_existing_skill_id
          ) THEN
            RAISE EXCEPTION 'Maximum limit of 15 skills per profile reached.';
          END IF;

          INSERT INTO public.profile_skills (profile_id, skill_id)
          VALUES (v_user_id, v_existing_skill_id)
          ON CONFLICT (profile_id, skill_id) DO NOTHING;
        ELSE
          IF v_current_skills_count >= 15 THEN
            RAISE EXCEPTION 'Maximum limit of 15 skills per profile reached.';
          END IF;

          INSERT INTO public.skills (name, source, is_active, created_by)
          VALUES (v_trimmed, 'user', false, v_user_id)
          RETURNING id INTO v_existing_skill_id;

          INSERT INTO public.profile_skills (profile_id, skill_id)
          VALUES (v_user_id, v_existing_skill_id)
          ON CONFLICT (profile_id, skill_id) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.rate_limit_events (user_id, action)
  VALUES (v_user_id, 'add_profile_skills');

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'add_profile_skills',
    'profiles',
    v_user_id,
    jsonb_build_object(
      'catalog_ids_count', coalesce(array_length(p_skill_ids, 1), 0),
      'custom_names_count', coalesce(array_length(p_custom_names, 1), 0)
    )
  );

  PERFORM public.get_profile_completeness(v_user_id);

  RETURN QUERY
  SELECT
    s.id AS out_skill_id,
    s.name AS out_skill_name,
    s.is_active AS out_is_active,
    s.source AS out_source
  FROM public.profile_skills ps
  JOIN public.skills s ON s.id = ps.skill_id
  WHERE ps.profile_id = v_user_id
  ORDER BY s.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_profile_skills(uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_profile_skills(uuid[], text[]) TO authenticated;

-- 5. RPC: remove_profile_skill(p_skill_id uuid)
-- Allows Freelancer (find_work) to remove a skill from their profile while blocking Hire mode callers.
DROP FUNCTION IF EXISTS public.remove_profile_skill(uuid);
CREATE OR REPLACE FUNCTION public.remove_profile_skill(
  p_skill_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
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

  IF COALESCE(v_profile.active_mode, '') <> 'find_work' THEN
    RAISE EXCEPTION 'Skills can only be modified in Find Work (Freelancer) mode.';
  END IF;

  DELETE FROM public.profile_skills
  WHERE profile_id = v_user_id AND skill_id = p_skill_id;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'remove_profile_skill',
    'profiles',
    v_user_id,
    jsonb_build_object('skill_id', p_skill_id)
  );

  PERFORM public.get_profile_completeness(v_user_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_profile_skill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_profile_skill(uuid) TO authenticated;

-- 6. RPC: save_hiring_details
-- Exclusively for Client ('hire') mode. Saves client_type, business_name (0 or 2-60 chars),
-- about_hiring (0-300 chars), and up to 8 hiring interest categories in profile_hiring_interests.
DROP FUNCTION IF EXISTS public.save_hiring_details(text, text, text, uuid[], text[]);
CREATE OR REPLACE FUNCTION public.save_hiring_details(
  p_client_type text DEFAULT NULL,
  p_business_name text DEFAULT NULL,
  p_about_hiring text DEFAULT NULL,
  p_category_ids uuid[] DEFAULT NULL,
  p_custom_category_names text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles;
  v_client_type text;
  v_biz_name text;
  v_about text;
  v_cat_id uuid;
  v_custom_name text;
  v_trimmed text;
  v_slug text;
  v_existing_cat_id uuid;
  v_final_cat_ids uuid[] := ARRAY[]::uuid[];
  v_interests jsonb := '[]'::jsonb;
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
    RAISE EXCEPTION 'Hiring details can only be saved in Hire Someone (Client) mode.';
  END IF;

  -- Validate client_type
  IF p_client_type IS NULL THEN
    v_client_type := v_profile.client_type;
  ELSIF trim(p_client_type) = '' THEN
    v_client_type := NULL;
  ELSE
    v_client_type := lower(trim(p_client_type));
    IF v_client_type NOT IN ('individual', 'business', 'organization', 'other') THEN
      RAISE EXCEPTION 'Invalid client type selection.';
    END IF;
  END IF;

  -- Validate business_name (optional, 2-60 chars if provided)
  v_biz_name := trim(COALESCE(p_business_name, v_profile.business_name, ''));
  IF v_biz_name <> '' AND (char_length(v_biz_name) < 2 OR char_length(v_biz_name) > 60) THEN
    RAISE EXCEPTION 'Business or organization name must be between 2 and 60 characters.';
  END IF;

  -- Validate about_hiring (optional, 0-300 chars)
  v_about := trim(COALESCE(p_about_hiring, v_profile.about_hiring, ''));
  IF char_length(v_about) > 300 THEN
    RAISE EXCEPTION 'About hiring note must be 300 characters or fewer.';
  END IF;

  -- Update hiring interests if category arrays were passed
  IF p_category_ids IS NOT NULL OR p_custom_category_names IS NOT NULL THEN
    -- 1. Collect valid catalog category IDs
    IF p_category_ids IS NOT NULL AND array_length(p_category_ids, 1) > 0 THEN
      FOREACH v_cat_id IN ARRAY p_category_ids
      LOOP
        IF v_cat_id IS NOT NULL AND NOT (v_cat_id = ANY(v_final_cat_ids)) THEN
          IF EXISTS (
            SELECT 1 FROM public.categories c
            WHERE c.id = v_cat_id AND (c.is_active = true OR c.created_by = v_user_id)
          ) THEN
            v_final_cat_ids := array_append(v_final_cat_ids, v_cat_id);
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- 2. Process custom category names (if catalog is empty or user typed a custom category)
    IF p_custom_category_names IS NOT NULL AND array_length(p_custom_category_names, 1) > 0 THEN
      FOREACH v_custom_name IN ARRAY p_custom_category_names
      LOOP
        v_trimmed := trim(COALESCE(v_custom_name, ''));
        IF v_trimmed <> '' THEN
          IF char_length(v_trimmed) < 2 OR char_length(v_trimmed) > 50 THEN
            RAISE EXCEPTION 'Category name must be between 2 and 50 characters: %', v_trimmed;
          END IF;

          SELECT c.id INTO v_existing_cat_id
          FROM public.categories c
          WHERE lower(trim(c.name)) = lower(v_trimmed)
          LIMIT 1;

          IF v_existing_cat_id IS NULL THEN
            v_slug := regexp_replace(lower(v_trimmed), '[^a-z0-9]+', '-', 'g');
            v_slug := trim(both '-' from v_slug);
            IF v_slug = '' THEN
              v_slug := 'cat';
            END IF;
            v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

            INSERT INTO public.categories (name, slug, is_active, source, created_by)
            VALUES (v_trimmed, v_slug, true, 'user', v_user_id)
            RETURNING id INTO v_existing_cat_id;
          END IF;

          IF v_existing_cat_id IS NOT NULL AND NOT (v_existing_cat_id = ANY(v_final_cat_ids)) THEN
            v_final_cat_ids := array_append(v_final_cat_ids, v_existing_cat_id);
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- Enforce max 8 hiring interests per profile
    IF COALESCE(array_length(v_final_cat_ids, 1), 0) > 8 THEN
      RAISE EXCEPTION 'You can select at most 8 hiring interests.';
    END IF;

    -- Replace profile_hiring_interests atomically
    DELETE FROM public.profile_hiring_interests
    WHERE profile_id = v_user_id;

    IF COALESCE(array_length(v_final_cat_ids, 1), 0) > 0 THEN
      FOREACH v_cat_id IN ARRAY v_final_cat_ids
      LOOP
        INSERT INTO public.profile_hiring_interests (profile_id, category_id)
        VALUES (v_user_id, v_cat_id)
        ON CONFLICT (profile_id, category_id) DO NOTHING;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.profiles
  SET client_type = v_client_type,
      business_name = v_biz_name,
      about_hiring = v_about,
      updated_at = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'save_hiring_details',
    'profiles',
    v_user_id,
    jsonb_build_object(
      'client_type', v_client_type,
      'interests_count', (SELECT count(*) FROM public.profile_hiring_interests WHERE profile_id = v_user_id)
    )
  );

  PERFORM public.get_profile_completeness(v_user_id);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug,
        'is_active', c.is_active
      ) ORDER BY c.name
    ),
    '[]'::jsonb
  ) INTO v_interests
  FROM public.profile_hiring_interests phi
  JOIN public.categories c ON c.id = phi.category_id
  WHERE phi.profile_id = v_user_id;

  RETURN jsonb_build_object(
    'profile_id', v_user_id,
    'client_type', v_profile.client_type,
    'business_name', v_profile.business_name,
    'about_hiring', v_profile.about_hiring,
    'hiring_interests', v_interests
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_hiring_details(text, text, text, uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_hiring_details(text, text, text, uuid[], text[]) TO authenticated;

-- 7. Update get_profile_completeness so 'other' is recognized as a valid client_type
DROP FUNCTION IF EXISTS public.get_profile_completeness(uuid);
CREATE OR REPLACE FUNCTION public.get_profile_completeness(
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_profile record;
  v_role text;
  v_total integer := 0;
  v_done integer := 0;
  v_missing jsonb := '[]'::jsonb;
  v_has_skill boolean := false;
  v_has_interest boolean := false;
  v_has_portfolio boolean := false;
  v_percent integer := 0;
  v_complete boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  v_role := COALESCE(v_profile.active_mode, 'find_work');

  SELECT EXISTS (
    SELECT 1 FROM public.portfolio_items WHERE profile_id = p_profile_id
  ) INTO v_has_portfolio;

  IF v_role = 'hire' THEN
    -- Client checklist (6 items): photo, display_name, bio (>=20), area, client_type, >=1 hiring interest (never skills)
    v_total := 6;

    -- 1. Photo
    IF v_profile.avatar_path IS NOT NULL AND trim(v_profile.avatar_path) <> '' THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'photo', 'label', 'Add a profile photo')
      );
    END IF;

    -- 2. Display name
    IF char_length(trim(COALESCE(v_profile.display_name, ''))) >= 2 THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'display_name', 'label', 'Add your display name')
      );
    END IF;

    -- 3. Bio (>= 20 chars)
    IF char_length(trim(COALESCE(v_profile.bio, ''))) >= 20 THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'bio', 'label', 'Write a bio (at least 20 characters)')
      );
    END IF;

    -- 4. Area
    IF char_length(trim(COALESCE(v_profile.area, ''))) >= 2 THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'area', 'label', 'Add your barangay or area')
      );
    END IF;

    -- 5. Client type
    IF v_profile.client_type IS NOT NULL AND v_profile.client_type IN ('individual', 'business', 'organization', 'other') THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'client_type', 'label', 'Select your client type')
      );
    END IF;

    -- 6. >= 1 Hiring interest
    SELECT EXISTS (
      SELECT 1 FROM public.profile_hiring_interests WHERE profile_id = p_profile_id
    ) INTO v_has_interest;

    IF v_has_interest THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'hiring_interests', 'label', 'Pick at least 1 hiring interest')
      );
    END IF;

  ELSE
    -- Freelancer checklist (7 items): photo, display_name, headline, bio (>=20), area, >=1 skill, work type + availability
    v_total := 7;

    -- 1. Photo
    IF v_profile.avatar_path IS NOT NULL AND trim(v_profile.avatar_path) <> '' THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'photo', 'label', 'Add a profile photo')
      );
    END IF;

    -- 2. Display name
    IF char_length(trim(COALESCE(v_profile.display_name, ''))) >= 2 THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'display_name', 'label', 'Add your display name')
      );
    END IF;

    -- 3. Headline
    IF char_length(trim(COALESCE(v_profile.headline, ''))) >= 2 THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'headline', 'label', 'Add a short headline')
      );
    END IF;

    -- 4. Bio (>= 20 chars)
    IF char_length(trim(COALESCE(v_profile.bio, ''))) >= 20 THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'bio', 'label', 'Write a bio (at least 20 characters)')
      );
    END IF;

    -- 5. Area
    IF char_length(trim(COALESCE(v_profile.area, ''))) >= 2 THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'area', 'label', 'Add your barangay or area')
      );
    END IF;

    -- 6. >= 1 Skill
    SELECT EXISTS (
      SELECT 1 FROM public.profile_skills WHERE profile_id = p_profile_id
    ) INTO v_has_skill;

    IF v_has_skill THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'skills', 'label', 'Add at least 1 skill')
      );
    END IF;

    -- 7. Work type & availability
    IF COALESCE(array_length(v_profile.work_types, 1), 0) >= 1 AND v_profile.availability IS NOT NULL THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('key', 'work_availability', 'label', 'Set your work types and availability')
      );
    END IF;
  END IF;

  v_percent := round((v_done::numeric / v_total::numeric) * 100)::integer;
  v_complete := (v_done = v_total);

  IF v_complete AND auth.uid() = p_profile_id THEN
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      body,
      entity_type,
      entity_id,
      data
    ) VALUES (
      p_profile_id,
      'profile_complete',
      'Profile complete',
      'Your profile is now 100% complete.',
      'profile',
      p_profile_id,
      jsonb_build_object('role', v_role)
    )
    ON CONFLICT (user_id) WHERE type = 'profile_complete' DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'profile_id', p_profile_id,
    'role', v_role,
    'percent', v_percent,
    'complete', v_complete,
    'missing_items', v_missing,
    'has_portfolio_bonus', v_has_portfolio
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_profile_completeness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_completeness(uuid) TO authenticated;

-- 8. Update update_profile_details to support client_type = 'other' and 2-60 char business_name rule
DROP FUNCTION IF EXISTS public.update_profile_details(text, text, text, text, text, text[], text, text[], text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.update_profile_details(
  p_display_name text,
  p_headline text DEFAULT NULL,
  p_bio text DEFAULT NULL,
  p_area text DEFAULT NULL,
  p_preferred_contact text DEFAULT NULL,
  p_languages text[] DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_work_types text[] DEFAULT NULL,
  p_availability text DEFAULT NULL,
  p_experience_years text DEFAULT NULL,
  p_starting_rate_note text DEFAULT NULL,
  p_client_type text DEFAULT NULL,
  p_business_name text DEFAULT NULL,
  p_about_hiring text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles;
  v_name text;
  v_headline text;
  v_bio text;
  v_area text;
  v_contact text;
  v_phone text;
  v_rate_note text;
  v_biz_name text;
  v_about_hiring text;
  v_lang text;
  v_wt text;
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

  v_name := trim(COALESCE(p_display_name, ''));
  IF char_length(v_name) < 2 OR char_length(v_name) > 50 THEN
    RAISE EXCEPTION 'Display name must be between 2 and 50 characters.';
  END IF;

  v_headline := trim(COALESCE(p_headline, v_profile.headline, ''));
  IF char_length(v_headline) > 80 THEN
    RAISE EXCEPTION 'Headline must be 80 characters or fewer.';
  END IF;

  v_bio := trim(COALESCE(p_bio, v_profile.bio, ''));
  IF v_bio <> '' AND (char_length(v_bio) < 20 OR char_length(v_bio) > 500) THEN
    RAISE EXCEPTION 'Bio must be between 20 and 500 characters.';
  END IF;

  v_area := trim(COALESCE(p_area, v_profile.area, ''));
  IF char_length(v_area) > 80 THEN
    RAISE EXCEPTION 'Area must be 80 characters or fewer.';
  END IF;

  v_contact := trim(COALESCE(p_preferred_contact, v_profile.preferred_contact, 'In-app chat'));
  IF char_length(v_contact) > 120 THEN
    RAISE EXCEPTION 'Preferred contact note must be 120 characters or fewer.';
  END IF;

  IF p_languages IS NOT NULL THEN
    FOREACH v_lang IN ARRAY p_languages
    LOOP
      IF v_lang NOT IN ('English', 'Tagalog', 'Bisaya', 'Waray', 'Other') THEN
        RAISE EXCEPTION 'Invalid language selection: %', v_lang;
      END IF;
    END LOOP;
  END IF;

  IF p_work_types IS NOT NULL THEN
    FOREACH v_wt IN ARRAY p_work_types
    LOOP
      IF v_wt NOT IN ('remote', 'face_to_face', 'hybrid') THEN
        RAISE EXCEPTION 'Invalid work type selection: %', v_wt;
      END IF;
    END LOOP;
  END IF;

  IF p_availability IS NOT NULL AND p_availability <> '' THEN
    IF p_availability NOT IN ('available_now', 'part_time', 'weekends', 'not_taking_work') THEN
      RAISE EXCEPTION 'Invalid availability selection.';
    END IF;
  END IF;

  IF p_experience_years IS NOT NULL AND p_experience_years <> '' THEN
    IF p_experience_years NOT IN ('lt_1', '1_3', '3_5', '5_plus') THEN
      RAISE EXCEPTION 'Invalid years of experience selection.';
    END IF;
  END IF;

  v_rate_note := trim(COALESCE(p_starting_rate_note, v_profile.starting_rate_note, ''));
  IF char_length(v_rate_note) > 120 THEN
    RAISE EXCEPTION 'Starting rate note must be 120 characters or fewer.';
  END IF;

  IF p_client_type IS NOT NULL AND p_client_type <> '' THEN
    IF p_client_type NOT IN ('individual', 'business', 'organization', 'other') THEN
      RAISE EXCEPTION 'Invalid client type selection.';
    END IF;
  END IF;

  v_biz_name := trim(COALESCE(p_business_name, v_profile.business_name, ''));
  IF v_biz_name <> '' AND (char_length(v_biz_name) < 2 OR char_length(v_biz_name) > 60) THEN
    RAISE EXCEPTION 'Business or organization name must be between 2 and 60 characters.';
  END IF;

  v_about_hiring := trim(COALESCE(p_about_hiring, v_profile.about_hiring, ''));
  IF char_length(v_about_hiring) > 300 THEN
    RAISE EXCEPTION 'About hiring note must be 300 characters or fewer.';
  END IF;

  IF p_phone IS NOT NULL THEN
    v_phone := trim(p_phone);
    IF v_phone <> '' AND v_phone !~ '^[0-9+() -]{7,20}$' THEN
      RAISE EXCEPTION 'Please enter a valid phone number (7 to 20 digits).';
    END IF;

    UPDATE public.profile_private
    SET phone = NULLIF(v_phone, '')
    WHERE user_id = v_user_id;
  END IF;

  UPDATE public.profiles
  SET display_name = v_name,
      headline = v_headline,
      bio = v_bio,
      area = v_area,
      preferred_contact = CASE WHEN v_contact = '' THEN 'In-app chat' ELSE v_contact END,
      languages = COALESCE(p_languages, v_profile.languages),
      work_types = COALESCE(p_work_types, v_profile.work_types),
      availability = CASE
        WHEN p_availability IS NULL THEN v_profile.availability
        WHEN p_availability = '' THEN NULL
        ELSE p_availability
      END,
      experience_years = CASE
        WHEN p_experience_years IS NULL THEN v_profile.experience_years
        WHEN p_experience_years = '' THEN NULL
        ELSE p_experience_years
      END,
      starting_rate_note = v_rate_note,
      client_type = CASE
        WHEN p_client_type IS NULL THEN v_profile.client_type
        WHEN p_client_type = '' THEN NULL
        ELSE p_client_type
      END,
      business_name = v_biz_name,
      about_hiring = v_about_hiring,
      updated_at = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'update_profile_details',
    'profiles',
    v_user_id,
    jsonb_build_object('active_mode', v_profile.active_mode)
  );

  PERFORM public.get_profile_completeness(v_user_id);

  RETURN v_profile;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_profile_details(text, text, text, text, text, text[], text, text[], text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_profile_details(text, text, text, text, text, text[], text, text[], text, text, text, text, text, text) TO authenticated;
