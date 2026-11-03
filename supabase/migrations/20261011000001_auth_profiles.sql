-- Milestone 1: Auth and Profiles
-- 100% Supabase. RLS default deny. 18+ enforced in database trigger.

-- 1. platform_admins
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No client policies for platform_admins: default deny.

-- 2. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  display_name text NOT NULL DEFAULT '',
  bio text DEFAULT '',
  avatar_path text,
  area text DEFAULT '',
  starting_mode text CHECK (starting_mode IN ('find_work', 'hire_someone', 'explore_both')) DEFAULT 'explore_both',
  onboarding_complete boolean NOT NULL DEFAULT false,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0.00,
  rating_count integer NOT NULL DEFAULT 0,
  completed_gigs integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (status = 'active' OR auth.uid() = id);

CREATE POLICY "Users can update own safe profile columns"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Protect system-controlled columns (ratings, counts, status) from direct update
CREATE OR REPLACE FUNCTION public.check_profile_update_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.rating_avg <> OLD.rating_avg OR
      NEW.rating_count <> OLD.rating_count OR
      NEW.completed_gigs <> OLD.completed_gigs OR
      NEW.status <> OLD.status) THEN
    IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()) THEN
      NEW.rating_avg := OLD.rating_avg;
      NEW.rating_count := OLD.rating_count;
      NEW.completed_gigs := OLD.completed_gigs;
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_check_profile_update_integrity ON public.profiles;
CREATE TRIGGER tr_check_profile_update_integrity
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.check_profile_update_integrity();

-- 3. profile_private
CREATE TABLE IF NOT EXISTS public.profile_private (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  dob date NOT NULL,
  phone text,
  terms_version text NOT NULL DEFAULT 'v1.0',
  terms_accepted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can view own private profile"
  ON public.profile_private
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Revoke direct mutations on protected tables
REVOKE INSERT, UPDATE, DELETE ON public.profile_private FROM anon, authenticated;
REVOKE INSERT, DELETE ON public.profiles FROM anon, authenticated;

-- 4. Trigger on auth.users for profile provisioning and 18+ gate
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
  v_display_name := COALESCE(NEW.raw_user_meta_data->>'display_name', '');
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
