-- Migration: 20261104000004_fix_client_mode_and_reviews.sql
-- Fixes missing reviews.role, profile_hiring_interests, categories, profile_private, skills, profile_skills, submissions, and RPC signatures.

-- 1. REVIEWS: Add role, reviewee_role, hidden columns and synchronize
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reviewee_role text;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS hidden boolean DEFAULT false;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS hidden_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.reviews
SET role = coalesce(target_role, 'client')
WHERE role IS NULL;

UPDATE public.reviews
SET reviewee_role = coalesce(target_role, role)
WHERE reviewee_role IS NULL;

CREATE OR REPLACE FUNCTION public.sync_reviews_roles()
RETURNS trigger AS $$
BEGIN
  IF NEW.role IS NULL AND NEW.target_role IS NOT NULL THEN
    NEW.role := NEW.target_role;
  ELSIF NEW.target_role IS NULL AND NEW.role IS NOT NULL THEN
    NEW.target_role := NEW.role;
  END IF;
  IF NEW.reviewee_role IS NULL THEN
    NEW.reviewee_role := COALESCE(NEW.role, NEW.target_role);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_reviews_roles ON public.reviews;
CREATE TRIGGER trg_sync_reviews_roles
BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.sync_reviews_roles();

-- 2. CATEGORIES
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'user')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_lower_name
  ON public.categories (lower(trim(name)));

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active categories" ON public.categories;
CREATE POLICY "Anyone can view active categories"
  ON public.categories FOR SELECT
  USING (is_active = true OR created_by = auth.uid());

GRANT SELECT ON public.categories TO anon, authenticated, service_role;
GRANT ALL ON public.categories TO service_role;

-- Seed default Ormoc categories
INSERT INTO public.categories (name, slug, is_active, source)
VALUES
  ('Home & Maintenance', 'home-maintenance', true, 'admin'),
  ('Construction & Carpentry', 'construction-carpentry', true, 'admin'),
  ('Tech & Development', 'tech-development', true, 'admin'),
  ('Design & Creative', 'design-creative', true, 'admin'),
  ('Cleaning & Housekeeping', 'cleaning-housekeeping', true, 'admin'),
  ('Events, Music & Photo', 'events-music-photo', true, 'admin'),
  ('Tutoring & Lessons', 'tutoring-lessons', true, 'admin'),
  ('Delivery & Logistics', 'delivery-logistics', true, 'admin'),
  ('Administrative & Virtual', 'administrative-virtual', true, 'admin'),
  ('Automotive & Electrical', 'automotive-electrical', true, 'admin')
ON CONFLICT (slug) DO NOTHING;

-- 3. PROFILE_HIRING_INTERESTS
CREATE TABLE IF NOT EXISTS public.profile_hiring_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, category_id)
);

ALTER TABLE public.profile_hiring_interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read profile hiring interests" ON public.profile_hiring_interests;
CREATE POLICY "Anyone can read profile hiring interests"
  ON public.profile_hiring_interests FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can manage own hiring interests" ON public.profile_hiring_interests;
CREATE POLICY "Users can manage own hiring interests"
  ON public.profile_hiring_interests FOR ALL
  USING (auth.uid() = profile_id);

GRANT ALL ON public.profile_hiring_interests TO anon, authenticated, service_role;

-- 4. SKILLS & PROFILE_SKILLS
CREATE TABLE IF NOT EXISTS public.skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'admin',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_lower_name
  ON public.skills (lower(trim(name)));

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active skills" ON public.skills;
CREATE POLICY "Anyone can read active skills"
  ON public.skills FOR SELECT
  USING (is_active = true OR created_by = auth.uid());

GRANT SELECT ON public.skills TO anon, authenticated, service_role;
GRANT ALL ON public.skills TO service_role;

CREATE TABLE IF NOT EXISTS public.profile_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, skill_id)
);

ALTER TABLE public.profile_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read profile skills" ON public.profile_skills;
CREATE POLICY "Anyone can read profile skills"
  ON public.profile_skills FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can manage own profile skills" ON public.profile_skills;
CREATE POLICY "Users can manage own profile skills"
  ON public.profile_skills FOR ALL
  USING (auth.uid() = profile_id);

GRANT ALL ON public.profile_skills TO anon, authenticated, service_role;

-- Seed skills from skills_catalog if exists
INSERT INTO public.skills (name, is_active, source)
SELECT name, true, 'catalog' FROM public.skills_catalog
ON CONFLICT (lower(trim(name))) DO NOTHING;

-- 5. PROFILE_PRIVATE
CREATE TABLE IF NOT EXISTS public.profile_private (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  dob date NOT NULL DEFAULT '2000-01-01',
  phone text,
  terms_version text NOT NULL DEFAULT 'v1.0',
  terms_accepted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can view own private profile" ON public.profile_private;
CREATE POLICY "Owner can view own private profile"
  ON public.profile_private FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner can update own private profile" ON public.profile_private;
CREATE POLICY "Owner can update own private profile"
  ON public.profile_private FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

GRANT ALL ON public.profile_private TO anon, authenticated, service_role;

-- Backfill profile_private from profiles
INSERT INTO public.profile_private (user_id, dob, phone)
SELECT id, coalesce(date_of_birth, '2000-01-01'::date), phone FROM public.profiles
ON CONFLICT (user_id) DO UPDATE SET phone = coalesce(EXCLUDED.phone, profile_private.phone);

-- 6. SUBMISSIONS
CREATE TABLE IF NOT EXISTS public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES public.milestones(id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  submission_number integer NOT NULL CHECK (submission_number >= 1 AND submission_number <= 3),
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  file_paths text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view submissions" ON public.submissions;
CREATE POLICY "Anyone can view submissions"
  ON public.submissions FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Freelancer can insert submission" ON public.submissions;
CREATE POLICY "Freelancer can insert submission"
  ON public.submissions FOR INSERT
  WITH CHECK (auth.uid() = freelancer_id);

GRANT ALL ON public.submissions TO anon, authenticated, service_role;

-- 7. AREAS
CREATE TABLE IF NOT EXISTS public.areas (
  id text PRIMARY KEY,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read areas" ON public.areas;
CREATE POLICY "Anyone can read areas" ON public.areas FOR SELECT USING (true);
GRANT ALL ON public.areas TO anon, authenticated, service_role;

INSERT INTO public.areas (id, name, is_active) VALUES
  ('cogon', 'Cogon', true),
  ('valencia', 'Valencia', true),
  ('linao', 'Linao', true),
  ('can-adieng', 'Can-adieng', true),
  ('ipil', 'Ipil', true),
  ('san-pablo', 'San Pablo', true),
  ('tambulilid', 'Tambulilid', true),
  ('mabini', 'Mabini', true),
  ('camp-downes', 'Camp Downes', true),
  ('alegria', 'Alegria', true),
  ('bantigue', 'Bantigue', true),
  ('curva', 'Curva', true),
  ('district-1', 'District 1', true),
  ('district-2', 'District 2', true),
  ('district-3', 'District 3', true),
  ('district-4', 'District 4', true)
ON CONFLICT (id) DO NOTHING;

-- 8. SAVE_HIRING_DETAILS FUNCTION
DROP FUNCTION IF EXISTS public.save_hiring_details CASCADE;

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

  v_biz_name := trim(COALESCE(p_business_name, v_profile.business_name, ''));
  IF v_biz_name <> '' AND (char_length(v_biz_name) < 2 OR char_length(v_biz_name) > 60) THEN
    RAISE EXCEPTION 'Business or organization name must be between 2 and 60 characters.';
  END IF;

  v_about := trim(COALESCE(p_about_hiring, v_profile.about_hiring, ''));
  IF char_length(v_about) > 300 THEN
    RAISE EXCEPTION 'About hiring note must be 300 characters or fewer.';
  END IF;

  IF p_category_ids IS NOT NULL OR p_custom_category_names IS NOT NULL THEN
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

    IF COALESCE(array_length(v_final_cat_ids, 1), 0) > 8 THEN
      RAISE EXCEPTION 'You can select at most 8 hiring interests.';
    END IF;

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
    'ok', true,
    'profile_id', v_user_id,
    'client_type', v_profile.client_type,
    'business_name', v_profile.business_name,
    'about_hiring', v_profile.about_hiring,
    'hiring_interests', v_interests
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_hiring_details(text, text, text, uuid[], text[]) TO anon, authenticated, service_role;

-- 9. UPDATE_PROFILE_DETAILS FUNCTION
DROP FUNCTION IF EXISTS public.update_profile_details CASCADE;

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
      area_barangay = v_area,
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
      phone = COALESCE(NULLIF(trim(p_phone), ''), v_profile.phone),
      updated_at = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_profile_details(text, text, text, text, text, text[], text, text[], text, text, text, text, text, text) TO anon, authenticated, service_role;

-- 10. RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
