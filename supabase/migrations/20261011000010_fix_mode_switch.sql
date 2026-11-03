-- Fix: protected profile columns were silently reverted even when changed by trusted
-- SECURITY DEFINER functions (choose_initial_mode, switch_mode, submit_review, payments, ...)
-- because the integrity trigger only let platform admins through.
-- Fix: trusted functions run as the function owner, so only direct API writes
-- (roles authenticated / anon) are reverted.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- SECURITY INVOKER on purpose: current_user is 'authenticated'/'anon' for direct API writes
-- and the function owner when a SECURITY DEFINER function does the update.
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
    NEW.rating_avg := OLD.rating_avg;
    NEW.rating_count := OLD.rating_count;
    NEW.completed_gigs := OLD.completed_gigs;
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

-- The first mode choice must NOT start the 7-day cooldown (spec section 3A).
CREATE OR REPLACE FUNCTION public.choose_initial_mode(target_mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_current_mode text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF target_mode NOT IN ('find_work', 'hire') THEN
    RAISE EXCEPTION 'Invalid mode. Must be find_work or hire.';
  END IF;

  SELECT active_mode INTO v_current_mode
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  IF v_current_mode IS NOT NULL THEN
    RAISE EXCEPTION 'Initial mode has already been chosen. Use switch_mode instead.';
  END IF;

  UPDATE public.profiles
  SET active_mode = target_mode
  WHERE id = v_user_id;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'choose_initial_mode', 'profiles', v_user_id, jsonb_build_object('mode', target_mode));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.choose_initial_mode(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.choose_initial_mode(text) TO authenticated;

-- Existing users who only made their first choice (never switched) should not be in cooldown.
UPDATE public.profiles p
SET mode_changed_at = NULL
WHERE p.mode_changed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_events a
    WHERE a.actor_id = p.id AND a.action = 'switch_mode'
  );
