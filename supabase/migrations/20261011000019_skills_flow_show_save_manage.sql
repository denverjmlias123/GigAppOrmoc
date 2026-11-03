-- Migration: 20261011000019_skills_flow_show_save_manage.sql
-- Milestone 19: Skills Flow — Show, Save, Manage (Freelancer Mode)
-- Strictly adheres to AGENTS.md, docs/MILESTONES.md (M19), and docs/PROFILE_AND_LOOP_V5_1.md Section 4.
-- Zero seed skills. All writes go through RLS / SECURITY DEFINER RPCs.

SET search_path = public, extensions;

-- 1. Ensure skills table has source, created_by, and unique lower(trim(name)) index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'skills' AND column_name = 'source'
  ) THEN
    ALTER TABLE public.skills
      ADD COLUMN source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'user'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'skills' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.skills
      ADD COLUMN created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_lower_name
  ON public.skills (lower(trim(name)));

-- 2. RLS on public.skills:
-- Authenticated users can read active catalog skills, skills they created, OR skills attached to their own profile_skills
-- (so when User B's custom skill deduplicates to User A's pending custom skill row, User B can still read it after relaunch).
DROP POLICY IF EXISTS "Anyone can view active skills" ON public.skills;
DROP POLICY IF EXISTS "Authenticated users can view active skills" ON public.skills;
DROP POLICY IF EXISTS "Authenticated users can view active or own skills" ON public.skills;
CREATE POLICY "Authenticated users can view active or own skills"
  ON public.skills
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profile_skills ps
      WHERE ps.skill_id = skills.id
        AND ps.profile_id = auth.uid()
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.skills FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.profile_skills FROM anon, authenticated, PUBLIC;

-- 3. Upgrade add_profile_skills(p_skill_ids uuid[], p_custom_names text[])
-- Enforces Section 4 rules:
-- - Freelancer mode ('find_work') only; rejects 'hire' mode
-- - Max 15 skills per profile
-- - Max 5 NEW custom skills per 24h per user (rate limit + audit)
-- - Custom skill validation: 2-40 chars, letters/numbers/space and & - + . / only, must include letters
-- - Rejects URLs, emails, phone numbers, and profanity
-- - Case-insensitive dedupe against catalog and other users' skills (reuses existing row, never duplicates)
-- - New custom skills are source = 'user', is_active = false (pending admin review), usable on owner's profile immediately
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
  v_new_custom_24h integer;
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

  IF v_recent_calls >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded for adding skills. Please try again later.';
  END IF;

  IF p_custom_names IS NOT NULL AND array_length(p_custom_names, 1) > 15 THEN
    RAISE EXCEPTION 'You may add at most 15 skills per profile.';
  END IF;

  -- 1. Process existing catalog/known skill IDs
  IF p_skill_ids IS NOT NULL AND array_length(p_skill_ids, 1) > 0 THEN
    FOREACH v_iter_skill_id IN ARRAY p_skill_ids
    LOOP
      IF v_iter_skill_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.skills s
          WHERE s.id = v_iter_skill_id
        ) THEN
          RAISE EXCEPTION 'Selected skill does not exist.';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM public.profile_skills ps
          WHERE ps.profile_id = v_user_id AND ps.skill_id = v_iter_skill_id
        ) THEN
          SELECT count(*) INTO v_current_skills_count
          FROM public.profile_skills
          WHERE profile_id = v_user_id;

          IF v_current_skills_count >= 15 THEN
            RAISE EXCEPTION 'Maximum limit of 15 skills per profile reached.';
          END IF;

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
      -- Normalize whitespace (trim + collapse internal spaces)
      v_trimmed := regexp_replace(trim(COALESCE(v_custom_name, '')), '\s+', ' ', 'g');

      IF v_trimmed <> '' THEN
        -- Length: 2-40 characters
        IF char_length(v_trimmed) < 2 OR char_length(v_trimmed) > 40 THEN
          RAISE EXCEPTION 'Custom skill name must be between 2 and 40 characters: %', v_trimmed;
        END IF;

        -- Reject emails first (before domain check)
        IF position('@' in v_trimmed) > 0 THEN
          RAISE EXCEPTION 'Skill name cannot contain an email address.';
        END IF;

        -- Reject URLs / websites
        IF v_trimmed ~* '(https?://|www\.|\.[a-z]{2,4}/|\.(com|net|org|ph|io)\y)' THEN
          RAISE EXCEPTION 'Skill name cannot contain a website or URL.';
        END IF;

        -- Reject phone numbers (7+ digits)
        IF char_length(regexp_replace(v_trimmed, '[^0-9]', '', 'g')) >= 7 THEN
          RAISE EXCEPTION 'Skill name cannot contain a phone number.';
        END IF;

        -- Must contain at least 1 letter (not pure numbers/symbols)
        IF char_length(regexp_replace(v_trimmed, '[^A-Za-z]', '', 'g')) < 1 THEN
          RAISE EXCEPTION 'Skill name must include letters.';
        END IF;

        -- Allowed characters: letters, numbers, space, and & - + . /
        IF v_trimmed !~ '^[A-Za-z0-9 &+\-./]+$' THEN
          RAISE EXCEPTION 'Skill name may only contain letters, numbers, spaces, and & - + . /.';
        END IF;

        -- Reject profanity / abusive terms
        IF v_trimmed ~* '\y(fuck|shit|bitch|asshole|puta|putangina|gago|tarantado|ulol|bobo|scam|scammer|porn|sex|shabu)\y' THEN
          RAISE EXCEPTION 'Skill name contains inappropriate language.';
        END IF;

        -- Case-insensitive dedupe against catalog AND other users' skills
        SELECT s.id INTO v_existing_skill_id
        FROM public.skills s
        WHERE lower(trim(s.name)) = lower(v_trimmed)
        LIMIT 1;

        IF v_existing_skill_id IS NOT NULL THEN
          -- Reuse existing skill row
          IF NOT EXISTS (
            SELECT 1 FROM public.profile_skills ps
            WHERE ps.profile_id = v_user_id AND ps.skill_id = v_existing_skill_id
          ) THEN
            SELECT count(*) INTO v_current_skills_count
            FROM public.profile_skills
            WHERE profile_id = v_user_id;

            IF v_current_skills_count >= 15 THEN
              RAISE EXCEPTION 'Maximum limit of 15 skills per profile reached.';
            END IF;

            INSERT INTO public.profile_skills (profile_id, skill_id)
            VALUES (v_user_id, v_existing_skill_id)
            ON CONFLICT (profile_id, skill_id) DO NOTHING;
          END IF;
        ELSE
          -- Creating a genuinely NEW custom skill
          SELECT count(*) INTO v_current_skills_count
          FROM public.profile_skills
          WHERE profile_id = v_user_id;

          IF v_current_skills_count >= 15 THEN
            RAISE EXCEPTION 'Maximum limit of 15 skills per profile reached.';
          END IF;

          -- Quota: max 5 NEW custom skills per 24h per user
          SELECT count(*) INTO v_new_custom_24h
          FROM public.skills s
          WHERE s.created_by = v_user_id
            AND s.source = 'user'
            AND s.created_at > now() - interval '24 hours';

          IF v_new_custom_24h >= 5 THEN
            RAISE EXCEPTION 'You can create at most 5 new custom skills per 24 hours.';
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
  ORDER BY s.name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_profile_skills(uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_profile_skills(uuid[], text[]) TO authenticated;

-- 4. Ensure remove_profile_skill(p_skill_id uuid) enforces find_work mode, audits, and recomputes completeness
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

  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active.';
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
