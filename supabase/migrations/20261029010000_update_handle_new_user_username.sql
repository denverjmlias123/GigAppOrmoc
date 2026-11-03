-- Migration 20261029010000: Update handle_new_user() trigger for username assignment
-- Automatically assigns unique username to new user profiles on signup

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
  v_username text;
BEGIN
  v_dob_str := NEW.raw_user_meta_data->>'dob';
  v_display_name := trim(COALESCE(NEW.raw_user_meta_data->>'display_name', ''));
  v_terms_version := COALESCE(NEW.raw_user_meta_data->>'terms_version', 'v1.0');
  v_username := lower(btrim(coalesce(NEW.raw_user_meta_data->>'username', '')));

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

  IF v_username = '' THEN
    v_username := lower(regexp_replace(v_display_name, '[^a-zA-Z0-9_]', '', 'g'));
    IF v_username = '' THEN
      v_username := 'user';
    END IF;
    v_username := v_username || '_' || substr(NEW.id::text, 1, 4);
  END IF;

  INSERT INTO public.profiles (id, display_name, username)
  VALUES (NEW.id, v_display_name, v_username)
  ON CONFLICT (id) DO UPDATE SET
    username = COALESCE(public.profiles.username, EXCLUDED.username);

  INSERT INTO public.profile_private (user_id, dob, terms_version, terms_accepted_at)
  VALUES (NEW.id, v_dob, v_terms_version, now())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
