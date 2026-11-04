-- Migration: 20261104000008_fix_onboarding_and_create_account_flow.sql
-- Fixes add_profile_skills RPC signature & catalog linking, complete_onboarding RPC,
-- rpc_complete_onboarding_step, and bidirectional synchronization on profiles table
-- for onboarding_complete <-> onboarding_completed, avatar_path <-> avatar_url, and area <-> area_barangay.

-- 1. Ensure columns exist on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS area text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS area_barangay text;

-- Backfill matching values
UPDATE public.profiles
SET onboarding_complete = true
WHERE onboarding_completed = true AND (onboarding_complete IS NULL OR onboarding_complete = false);

UPDATE public.profiles
SET onboarding_completed = true
WHERE onboarding_complete = true AND (onboarding_completed IS NULL OR onboarding_completed = false);

UPDATE public.profiles
SET avatar_path = avatar_url
WHERE avatar_path IS NULL AND avatar_url IS NOT NULL;

UPDATE public.profiles
SET avatar_url = avatar_path
WHERE avatar_url IS NULL AND avatar_path IS NOT NULL;

UPDATE public.profiles
SET area = area_barangay
WHERE area IS NULL AND area_barangay IS NOT NULL;

UPDATE public.profiles
SET area_barangay = area
WHERE area_barangay IS NULL AND area IS NOT NULL;

-- 2. Trigger for automatic synchronization of profile fields
CREATE OR REPLACE FUNCTION public.sync_profile_compat_fields()
RETURNS trigger AS $$
BEGIN
  -- Synchronize onboarding flags
  IF NEW.onboarding_complete = true OR NEW.onboarding_completed = true THEN
    NEW.onboarding_complete := true;
    NEW.onboarding_completed := true;
  END IF;

  -- Synchronize avatars
  IF NEW.avatar_path IS NOT NULL AND (NEW.avatar_url IS NULL OR NEW.avatar_url <> NEW.avatar_path) THEN
    NEW.avatar_url := NEW.avatar_path;
  ELSIF NEW.avatar_url IS NOT NULL AND (NEW.avatar_path IS NULL OR NEW.avatar_path <> NEW.avatar_url) THEN
    NEW.avatar_path := NEW.avatar_url;
  ELSIF NEW.avatar_path IS NULL AND NEW.avatar_url IS NULL THEN
    NEW.avatar_path := NULL;
    NEW.avatar_url := NULL;
  END IF;

  -- Synchronize area / area_barangay
  IF NEW.area IS NOT NULL AND (NEW.area_barangay IS NULL OR NEW.area_barangay <> NEW.area) THEN
    NEW.area_barangay := NEW.area;
  ELSIF NEW.area_barangay IS NOT NULL AND (NEW.area IS NULL OR NEW.area <> NEW.area_barangay) THEN
    NEW.area := NEW.area_barangay;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_profile_compat_fields ON public.profiles;
CREATE TRIGGER trg_sync_profile_compat_fields
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_compat_fields();

-- 3. Overload & unify add_profile_skills to accept (uuid[], text[]) and return added skills
DROP FUNCTION IF EXISTS public.add_profile_skills(uuid[], text[]);
DROP FUNCTION IF EXISTS public.add_profile_skills(text[]);

CREATE OR REPLACE FUNCTION public.add_profile_skills(
  p_skill_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_custom_names text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE (
  id uuid,
  name text,
  category_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_custom_name text;
  v_skill_id uuid;
  v_clean_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  -- Ensure profile exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE public.profiles.id = v_uid) THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  -- Insert catalog skills by ID
  IF p_skill_ids IS NOT NULL AND array_length(p_skill_ids, 1) > 0 THEN
    FOR v_skill_id IN SELECT unnest(p_skill_ids) LOOP
      IF EXISTS (SELECT 1 FROM public.skills WHERE public.skills.id = v_skill_id) THEN
        INSERT INTO public.profile_skills (profile_id, skill_id)
        VALUES (v_uid, v_skill_id)
        ON CONFLICT (profile_id, skill_id) DO NOTHING;

        -- Mirror into user_skills
        SELECT public.skills.name INTO v_clean_name FROM public.skills WHERE public.skills.id = v_skill_id;
        IF v_clean_name IS NOT NULL THEN
          INSERT INTO public.user_skills (user_id, skill_name)
          VALUES (v_uid, v_clean_name)
          ON CONFLICT (user_id, skill_name) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Insert custom skills by name
  IF p_custom_names IS NOT NULL AND array_length(p_custom_names, 1) > 0 THEN
    FOR v_custom_name IN SELECT unnest(p_custom_names) LOOP
      v_clean_name := trim(v_custom_name);
      IF length(v_clean_name) >= 2 AND length(v_clean_name) <= 40 THEN
        -- Check if skill exists in public.skills
        SELECT public.skills.id INTO v_skill_id
        FROM public.skills
        WHERE lower(trim(public.skills.name)) = lower(v_clean_name)
        LIMIT 1;

        IF v_skill_id IS NULL THEN
          -- Create user-suggested skill
          INSERT INTO public.skills (name, source, is_active)
          VALUES (v_clean_name, 'user', true)
          ON CONFLICT DO NOTHING
          RETURNING public.skills.id INTO v_skill_id;

          IF v_skill_id IS NULL THEN
            SELECT public.skills.id INTO v_skill_id
            FROM public.skills
            WHERE lower(trim(public.skills.name)) = lower(v_clean_name)
            LIMIT 1;
          END IF;
        END IF;

        IF v_skill_id IS NOT NULL THEN
          INSERT INTO public.profile_skills (profile_id, skill_id)
          VALUES (v_uid, v_skill_id)
          ON CONFLICT (profile_id, skill_id) DO NOTHING;
        END IF;

        -- Mirror into user_skills
        INSERT INTO public.user_skills (user_id, skill_name)
        VALUES (v_uid, v_clean_name)
        ON CONFLICT (user_id, skill_name) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.profiles
  SET onboarding_step = GREATEST(coalesce(onboarding_step, 1), 2),
      updated_at = now()
  WHERE public.profiles.id = v_uid;

  -- Return all profile skills
  RETURN QUERY
  SELECT s.id, s.name, s.category_id
  FROM public.profile_skills ps
  JOIN public.skills s ON s.id = ps.skill_id
  WHERE ps.profile_id = v_uid
  ORDER BY s.name ASC;
END;
$$;

-- Backward compatibility overload for text[] only
CREATE OR REPLACE FUNCTION public.add_profile_skills(
  p_skill_names text[]
)
RETURNS TABLE (
  id uuid,
  name text,
  category_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], p_skill_names);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_profile_skills(uuid[], text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_profile_skills(text[]) TO anon, authenticated, service_role;

-- 4. Complete Onboarding RPC
DROP FUNCTION IF EXISTS public.complete_onboarding();
DROP FUNCTION IF EXISTS public.complete_onboarding(text);

CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_mode text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target_mode text := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_mode IS NOT NULL AND trim(p_mode) <> '' THEN
    IF p_mode IN ('hire', 'client') THEN
      v_target_mode := 'hire';
    ELSIF p_mode IN ('find_work', 'freelancer') THEN
      v_target_mode := 'find_work';
    END IF;
  END IF;

  UPDATE public.profiles
  SET onboarding_completed = true,
      onboarding_complete = true,
      onboarding_step = 3,
      active_mode = COALESCE(v_target_mode, active_mode, 'find_work'),
      updated_at = now()
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'onboarding_complete', true,
    'onboarding_completed', true,
    'user_id', v_uid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_onboarding(text) TO anon, authenticated, service_role;

-- 5. Update rpc_complete_onboarding_step to update all compat columns
CREATE OR REPLACE FUNCTION public.rpc_complete_onboarding_step(
  p_step integer,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_skill text;
  v_mode text;
  v_area text;
  v_avatar text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  IF p_step = 1 THEN
    v_mode := p_payload->>'active_mode';
    IF v_mode IN ('hire', 'client') THEN
      v_mode := 'hire';
    ELSIF v_mode IN ('find_work', 'freelancer') THEN
      v_mode := 'find_work';
    ELSE
      v_mode := 'find_work';
    END IF;

    UPDATE public.profiles
    SET active_mode = v_mode,
        onboarding_step = GREATEST(coalesce(onboarding_step, 1), 2),
        updated_at = now()
    WHERE id = v_uid;

  ELSIF p_step = 2 THEN
    IF p_payload ? 'skills' THEN
      FOR v_skill IN SELECT jsonb_array_elements_text(p_payload->'skills') LOOP
        INSERT INTO public.user_skills (user_id, skill_name)
        VALUES (v_uid, trim(v_skill))
        ON CONFLICT (user_id, skill_name) DO NOTHING;
      END LOOP;
    END IF;

    IF p_payload ? 'client_type' THEN
      UPDATE public.profiles
      SET client_type = p_payload->>'client_type',
          business_name = p_payload->>'business_name',
          about_hiring = p_payload->>'about_hiring',
          hiring_interests = ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'hiring_interests', '[]'::jsonb))),
          updated_at = now()
      WHERE id = v_uid;
    END IF;

    UPDATE public.profiles
    SET onboarding_step = GREATEST(coalesce(onboarding_step, 1), 3),
        updated_at = now()
    WHERE id = v_uid;

  ELSIF p_step = 3 THEN
    v_area := coalesce(p_payload->>'area', p_payload->>'area_barangay');
    v_avatar := coalesce(p_payload->>'avatar_path', p_payload->>'avatar_url');

    UPDATE public.profiles
    SET area = coalesce(v_area, area),
        area_barangay = coalesce(v_area, area_barangay),
        bio = coalesce(p_payload->>'bio', bio),
        avatar_path = coalesce(v_avatar, avatar_path),
        avatar_url = coalesce(v_avatar, avatar_url),
        onboarding_completed = true,
        onboarding_complete = true,
        onboarding_step = 3,
        updated_at = now()
    WHERE id = v_uid;

    PERFORM public.internal_log_audit(v_uid, NULL, 'ONBOARDING_COMPLETED', 'ONBOARDING', NULL, 'SUCCESS', '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object('ok', true, 'step', p_step);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_complete_onboarding_step(integer, jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
