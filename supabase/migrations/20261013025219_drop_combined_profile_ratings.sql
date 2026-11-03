-- Remove legacy combined reputation columns. Reputation is role-specific.
-- Update the guard first so it no longer references the columns being dropped.
-- Stop safely if the legacy fields contain reputation data that has not been
-- represented by role-specific reviews. Never discard ratings silently.
DO $$
DECLARE
  v_column_name text;
  v_has_legacy_value boolean;
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Expected public.profiles to exist before removing legacy rating fields.';
  END IF;

  FOREACH v_column_name IN ARRAY ARRAY['rating_avg', 'rating_count', 'completed_gigs'] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name = v_column_name
    ) THEN
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.profiles WHERE coalesce(%I, 0) <> 0)',
        v_column_name
      ) INTO v_has_legacy_value;

      IF v_has_legacy_value THEN
        RAISE EXCEPTION
          'Cannot remove public.profiles.% because it contains non-zero legacy values. Reconcile those values against role-specific reviews and agreements first.',
          v_column_name;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_profile_update_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT public.is_platform_admin() THEN
    NEW.active_mode := OLD.active_mode;
    NEW.mode_changed_at := OLD.mode_changed_at;
    NEW.freelancer_rating_avg := OLD.freelancer_rating_avg;
    NEW.freelancer_rating_count := OLD.freelancer_rating_count;
    NEW.client_rating_avg := OLD.client_rating_avg;
    NEW.client_rating_count := OLD.client_rating_count;
    NEW.freelancer_completed_gigs := OLD.freelancer_completed_gigs;
    NEW.client_completed_gigs := OLD.client_completed_gigs;
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS rating_avg,
  DROP COLUMN IF EXISTS rating_count,
  DROP COLUMN IF EXISTS completed_gigs;
