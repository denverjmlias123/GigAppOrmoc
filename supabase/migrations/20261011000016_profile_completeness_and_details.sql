-- Migration: 20261011000016_profile_completeness_and_details.sql
-- Milestone 16: Duplicate email safety net, richer profile details, DB-computed profile completeness, and avatar management
-- Strictly adheres to AGENTS.md and docs/PROFILE_AND_LOOP_V5_1.md sections 5 and 6. No seed data.

-- 1. Database safety net for account creation (Section 6)
-- Ensure handle_new_user normalizes email metadata and remains strictly idempotent (one auth user -> at most one profile & one profile_private)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_dob_str text;
  v_dob date;
  v_age integer;
  v_display_name text;
  v_terms_version text;
BEGIN
  v_dob_str := NEW.raw_user_meta_data->>'dob';
  v_display_name := trim(COALESCE(NEW.raw_user_meta_data->>'display_name', ''));
  v_terms_version := COALESCE(NEW.raw_user_meta_data->>'terms_version', 'v1.0');

  IF v_dob_str IS NULL OR trim(v_dob_str) = '' THEN
    RAISE EXCEPTION 'Date of birth is required.';
  END IF;

  BEGIN
    v_dob := v_dob_str::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid date of birth format. Expected YYYY-MM-DD.';
  END;

  v_age := date_part('year', age(current_date, v_dob));
  IF v_age < 18 THEN
    RAISE EXCEPTION 'Users must be at least 18 years old to register.';
  END IF;

  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profile_private (user_id, dob, terms_version, terms_accepted_at)
  VALUES (NEW.id, v_dob, v_terms_version, now())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 2. Expand public.profiles with richer details (Section 5.2 & Section 3)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS headline text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preferred_contact text NOT NULL DEFAULT 'In-app chat',
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS work_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS availability text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS experience_years text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS starting_rate_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS business_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS about_hiring text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_headline_len_chk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_headline_len_chk CHECK (char_length(headline) <= 80);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_availability_chk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_availability_chk CHECK (
        availability IS NULL OR availability IN ('available_now', 'part_time', 'weekends', 'not_taking_work')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_experience_years_chk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_experience_years_chk CHECK (
        experience_years IS NULL OR experience_years IN ('lt_1', '1_3', '3_5', '5_plus')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_client_type_chk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_client_type_chk CHECK (
        client_type IS NULL OR client_type IN ('individual', 'business', 'organization')
      );
  END IF;
END $$;

-- 3. Create profile_hiring_interests table (used by client completeness checklist & hiring details)
CREATE TABLE IF NOT EXISTS public.profile_hiring_interests (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, category_id)
);

ALTER TABLE public.profile_hiring_interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view hiring interests" ON public.profile_hiring_interests;
CREATE POLICY "Authenticated users can view hiring interests"
  ON public.profile_hiring_interests
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.profile_hiring_interests FROM anon, authenticated, PUBLIC;

-- 4. Ensure avatars bucket has 5MB limit and jpeg/png/webp mime types (Section 5.3)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('portfolio', 'portfolio', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 5. Ensure profile_complete notification can only be emitted ONCE per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_profile_complete_once
  ON public.notifications (user_id)
  WHERE type = 'profile_complete';

-- 6. RPC: get_profile_completeness(p_profile_id uuid)
-- Computes completeness in SQL (never trusted from client).
-- Emits 'profile_complete' notification once when the owner's profile reaches 100%.
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
    -- Client checklist (6 items): photo, display_name, bio (>=20), area, client_type, >=1 hiring interest
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
    IF v_profile.client_type IS NOT NULL AND v_profile.client_type IN ('individual', 'business', 'organization') THEN
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

  -- Emit one-time notification 'profile_complete' the first time the profile reaches 100%
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

-- 7. RPC: update_profile_details (Section 5.2)
-- Validates all fields in SQL, saves optional phone ONLY in profile_private, and triggers completeness check.
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

  -- Validate display_name (2-50 chars)
  v_name := trim(COALESCE(p_display_name, ''));
  IF char_length(v_name) < 2 OR char_length(v_name) > 50 THEN
    RAISE EXCEPTION 'Display name must be between 2 and 50 characters.';
  END IF;

  -- Validate headline (<= 80 chars)
  v_headline := trim(COALESCE(p_headline, v_profile.headline, ''));
  IF char_length(v_headline) > 80 THEN
    RAISE EXCEPTION 'Headline must be 80 characters or fewer.';
  END IF;

  -- Validate bio (empty or 20-500 chars)
  v_bio := trim(COALESCE(p_bio, v_profile.bio, ''));
  IF v_bio <> '' AND (char_length(v_bio) < 20 OR char_length(v_bio) > 500) THEN
    RAISE EXCEPTION 'Bio must be between 20 and 500 characters.';
  END IF;

  -- Validate area (<= 80 chars)
  v_area := trim(COALESCE(p_area, v_profile.area, ''));
  IF char_length(v_area) > 80 THEN
    RAISE EXCEPTION 'Area must be 80 characters or fewer.';
  END IF;

  -- Validate preferred contact note (<= 120 chars)
  v_contact := trim(COALESCE(p_preferred_contact, v_profile.preferred_contact, 'In-app chat'));
  IF char_length(v_contact) > 120 THEN
    RAISE EXCEPTION 'Preferred contact note must be 120 characters or fewer.';
  END IF;

  -- Validate languages
  IF p_languages IS NOT NULL THEN
    FOREACH v_lang IN ARRAY p_languages
    LOOP
      IF v_lang NOT IN ('English', 'Tagalog', 'Bisaya', 'Waray', 'Other') THEN
        RAISE EXCEPTION 'Invalid language selection: %', v_lang;
      END IF;
    END LOOP;
  END IF;

  -- Validate work_types
  IF p_work_types IS NOT NULL THEN
    FOREACH v_wt IN ARRAY p_work_types
    LOOP
      IF v_wt NOT IN ('remote', 'face_to_face', 'hybrid') THEN
        RAISE EXCEPTION 'Invalid work type selection: %', v_wt;
      END IF;
    END LOOP;
  END IF;

  -- Validate availability
  IF p_availability IS NOT NULL AND p_availability <> '' THEN
    IF p_availability NOT IN ('available_now', 'part_time', 'weekends', 'not_taking_work') THEN
      RAISE EXCEPTION 'Invalid availability selection.';
    END IF;
  END IF;

  -- Validate experience_years
  IF p_experience_years IS NOT NULL AND p_experience_years <> '' THEN
    IF p_experience_years NOT IN ('lt_1', '1_3', '3_5', '5_plus') THEN
      RAISE EXCEPTION 'Invalid years of experience selection.';
    END IF;
  END IF;

  -- Validate starting_rate_note (<= 120 chars)
  v_rate_note := trim(COALESCE(p_starting_rate_note, v_profile.starting_rate_note, ''));
  IF char_length(v_rate_note) > 120 THEN
    RAISE EXCEPTION 'Starting rate note must be 120 characters or fewer.';
  END IF;

  -- Validate client_type
  IF p_client_type IS NOT NULL AND p_client_type <> '' THEN
    IF p_client_type NOT IN ('individual', 'business', 'organization') THEN
      RAISE EXCEPTION 'Invalid client type selection.';
    END IF;
  END IF;

  -- Validate business_name (<= 80 chars)
  v_biz_name := trim(COALESCE(p_business_name, v_profile.business_name, ''));
  IF char_length(v_biz_name) > 80 THEN
    RAISE EXCEPTION 'Business name must be 80 characters or fewer.';
  END IF;

  -- Validate about_hiring (<= 300 chars)
  v_about_hiring := trim(COALESCE(p_about_hiring, v_profile.about_hiring, ''));
  IF char_length(v_about_hiring) > 300 THEN
    RAISE EXCEPTION 'About hiring note must be 300 characters or fewer.';
  END IF;

  -- Validate and update optional phone ONLY in profile_private
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

  -- Evaluate completeness (emits one-time profile_complete notification if 100%)
  PERFORM public.get_profile_completeness(v_user_id);

  RETURN v_profile;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_profile_details(text, text, text, text, text, text[], text, text[], text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_profile_details(text, text, text, text, text, text[], text, text[], text, text, text, text, text, text) TO authenticated;

-- 8. RPC: set_profile_avatar(p_avatar_path text) (Section 5.3)
-- Sets or clears profiles.avatar_path after upload or removal, returns previous avatar_path so client can delete old object.
DROP FUNCTION IF EXISTS public.set_profile_avatar(text);
CREATE OR REPLACE FUNCTION public.set_profile_avatar(
  p_avatar_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_old_path text;
  v_new_path text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT avatar_path INTO v_old_path
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  v_new_path := NULLIF(trim(COALESCE(p_avatar_path, '')), '');

  -- Ensure non-null avatar_path belongs to caller's own folder
  IF v_new_path IS NOT NULL AND position(v_user_id::text || '/' in v_new_path) = 0 THEN
    RAISE EXCEPTION 'Avatar path must be inside your own user folder.';
  END IF;

  UPDATE public.profiles
  SET avatar_path = v_new_path,
      updated_at = now()
  WHERE id = v_user_id;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    CASE WHEN v_new_path IS NULL THEN 'remove_avatar' ELSE 'update_avatar' END,
    'profiles',
    v_user_id,
    jsonb_build_object('previous_avatar_path', v_old_path, 'new_avatar_path', v_new_path)
  );

  PERFORM public.get_profile_completeness(v_user_id);

  RETURN jsonb_build_object(
    'previous_avatar_path', v_old_path,
    'avatar_path', v_new_path
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_profile_avatar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_profile_avatar(text) TO authenticated;
