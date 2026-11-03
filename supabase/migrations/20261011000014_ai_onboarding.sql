-- Migration: 20261011000014_ai_onboarding.sql
-- Milestone 14: AI in Onboarding (Skills, Bio & Edge Function Backing)
-- Strictly adheres to docs/REAL_LOGIC_V5.md sections 1, 2, and 5 and AGENTS.md

-- 0. Ensure updated_at exists on profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.profiles 
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- 1. Alter skills table to support user-originated custom skills
-- Add source column ('admin' or 'user') and created_by reference
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'skills' AND column_name = 'source'
  ) THEN
    ALTER TABLE public.skills 
      ADD COLUMN source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'user'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'skills' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.skills 
      ADD COLUMN created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  -- Relax category_id nullability for user-suggested custom skills (categorized by admin later)
  ALTER TABLE public.skills ALTER COLUMN category_id DROP NOT NULL;
END $$;

-- Add unique case-insensitive index on skills(lower(trim(name)))
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_lower_name ON public.skills (lower(trim(name)));

-- Update RLS on skills:
-- Authenticated users can view active skills OR pending user skills created by themselves
DROP POLICY IF EXISTS "Authenticated users can view active skills" ON public.skills;
CREATE POLICY "Authenticated users can view active or own skills"
  ON public.skills
  FOR SELECT
  TO authenticated
  USING (is_active = true OR created_by = auth.uid());

-- Direct client write operations on skills remain denied (RPC-only via add_profile_skills)
REVOKE INSERT, UPDATE, DELETE ON public.skills FROM anon, authenticated, PUBLIC;

-- 2. Create areas reference table
CREATE TABLE IF NOT EXISTS public.areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view active areas" ON public.areas;
CREATE POLICY "Authenticated users can view active areas"
  ON public.areas
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Direct client modifications denied on areas
REVOKE INSERT, UPDATE, DELETE ON public.areas FROM anon, authenticated, PUBLIC;

-- 3. RPC: add_profile_skills(p_skill_ids uuid[], p_custom_names text[])
-- Adds verified catalog skills and/or creates custom user skills (is_active = false)
-- Links them into profile_skills for the authenticated caller
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
  v_skill_id uuid;
  v_custom_name text;
  v_trimmed text;
  v_current_skills_count integer;
  v_new_skills_count integer;
  v_existing_skill_id uuid;
  v_recent_calls integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  -- Verify active profile
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

  -- Rate limit check: max 15 add_profile_skills calls per hour
  SELECT count(*) INTO v_recent_calls
  FROM public.rate_limit_events
  WHERE user_id = v_user_id
    AND action = 'add_profile_skills'
    AND created_at > now() - interval '1 hour';

  IF v_recent_calls >= 15 THEN
    RAISE EXCEPTION 'Rate limit exceeded for adding skills. Please try again later.';
  END IF;

  -- Validate maximum custom skills per single call
  IF array_length(p_custom_names, 1) > 10 THEN
    RAISE EXCEPTION 'You may add at most 10 custom skills per request.';
  END IF;

  -- Check current skill count on profile
  SELECT count(*) INTO v_current_skills_count
  FROM public.profile_skills
  WHERE profile_id = v_user_id;

  -- 1. Process existing catalog skill IDs
  IF p_skill_ids IS NOT NULL AND array_length(p_skill_ids, 1) > 0 THEN
    FOREACH v_skill_id IN ARRAY p_skill_ids
    LOOP
      IF v_skill_id IS NOT NULL THEN
        -- Check if skill exists and is visible to caller
        IF EXISTS (
          SELECT 1 FROM public.skills
          WHERE id = v_skill_id AND (is_active = true OR created_by = v_user_id)
        ) THEN
          INSERT INTO public.profile_skills (profile_id, skill_id)
          VALUES (v_user_id, v_skill_id)
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

        -- Check profile skills ceiling (max 15 skills per profile)
        SELECT count(*) INTO v_current_skills_count
        FROM public.profile_skills
        WHERE profile_id = v_user_id;

        IF v_current_skills_count >= 15 THEN
          RAISE EXCEPTION 'Maximum limit of 15 skills per profile reached.';
        END IF;

        -- Check if skill already exists (case-insensitive)
        SELECT s.id INTO v_existing_skill_id
        FROM public.skills s
        WHERE lower(trim(s.name)) = lower(v_trimmed);

        IF v_existing_skill_id IS NOT NULL THEN
          -- Link existing skill
          INSERT INTO public.profile_skills (profile_id, skill_id)
          VALUES (v_user_id, v_existing_skill_id)
          ON CONFLICT (profile_id, skill_id) DO NOTHING;
        ELSE
          -- Create user skill (is_active = false, pending admin review)
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

  -- Record rate limit and audit events
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

  -- Return updated caller profile skills
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

-- 4. RPC: complete_onboarding()
-- Verifies mode chosen and marks onboarding_complete = true atomically
DROP FUNCTION IF EXISTS public.complete_onboarding CASCADE;
CREATE OR REPLACE FUNCTION public.complete_onboarding()
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

  IF v_profile.active_mode IS NULL OR v_profile.active_mode NOT IN ('find_work', 'hire') THEN
    RAISE EXCEPTION 'You must select an initial role mode (Find Work or Hire Someone) before completing onboarding.';
  END IF;

  UPDATE public.profiles
  SET onboarding_complete = true,
      updated_at = now()
  WHERE id = v_user_id;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'complete_onboarding',
    'profiles',
    v_user_id,
    jsonb_build_object('active_mode', v_profile.active_mode)
  );
END;
$$;

-- 5. Revoke execute on new functions from anon and public, grant to authenticated
REVOKE EXECUTE ON FUNCTION public.add_profile_skills(uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_profile_skills(uuid[], text[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding() TO authenticated;
