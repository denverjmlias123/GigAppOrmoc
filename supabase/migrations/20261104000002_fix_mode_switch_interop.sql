-- Migration: 20261104000002_fix_mode_switch_interop.sql
-- Fix active_mode check constraint, switch_mode RPC signature, choose_initial_mode, and rpc_create_or_update_gig

-- 1. Relax check constraint on profiles to accept find_work, hire, freelancer, client
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_active_mode_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_active_mode_check 
  CHECK (active_mode IN ('find_work', 'hire', 'freelancer', 'client'));

-- 2. Normalize existing profiles to find_work / hire
UPDATE public.profiles SET active_mode = 'find_work' WHERE active_mode = 'freelancer';
UPDATE public.profiles SET active_mode = 'hire' WHERE active_mode = 'client';

-- 3. Update handle_new_user to default to 'find_work'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_dob_str text;
  v_dob date;
  v_display_name text;
  v_username text;
  v_email text := lower(trim(NEW.email));
BEGIN
  v_dob_str := NEW.raw_user_meta_data->>'dob';
  v_display_name := trim(COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(v_email, '@', 1)));
  v_username := lower(btrim(coalesce(NEW.raw_user_meta_data->>'username', '')));

  IF v_dob_str IS NOT NULL AND trim(v_dob_str) <> '' THEN
    BEGIN
      v_dob := v_dob_str::date;
    EXCEPTION WHEN OTHERS THEN
      v_dob := '2000-01-01'::date;
    END;
  ELSE
    v_dob := '2000-01-01'::date;
  END IF;

  IF v_username = '' THEN
    v_username := lower(regexp_replace(split_part(v_email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
    IF v_username = '' THEN
      v_username := 'user';
    END IF;
    v_username := v_username || '_' || substr(replace(NEW.id::text, '-', ''), 1, 6);
  END IF;

  INSERT INTO public.profiles (
    id, username, email, display_name, date_of_birth, active_mode, email_verified, onboarding_completed, onboarding_step
  ) VALUES (
    NEW.id, v_username, v_email, v_display_name, v_dob, 'find_work', (NEW.email_confirmed_at IS NOT NULL), false, 1
  ) ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(nullif(EXCLUDED.display_name, ''), public.profiles.display_name);

  INSERT INTO public.login_security_state (user_id, failed_attempts, lockout_tier, captcha_required)
  VALUES (NEW.id, 0, 0, false)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 4. Upgrade rpc_switch_user_mode to handle both formats & avoid blocking onboarding
CREATE OR REPLACE FUNCTION public.rpc_switch_user_mode(p_target_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_target text;
  v_is_super_or_admin boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  -- Normalize target mode
  IF p_target_mode IN ('hire', 'client') THEN
    v_target := 'hire';
  ELSIF p_target_mode IN ('find_work', 'freelancer') THEN
    v_target := 'find_work';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MODE', 'message', 'Invalid target mode. Must be find_work or hire.');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;

  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Profile not found.');
  END IF;

  IF v_profile.is_admin_locked OR NOT v_profile.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_LOCKED', 'message', 'Locked accounts cannot switch modes.');
  END IF;

  SELECT public.is_admin() INTO v_is_super_or_admin;

  -- Blocker 1: 7-day cooldown (only if onboarding is completed and user is not admin)
  IF coalesce(v_profile.onboarding_completed, false) = true AND NOT coalesce(v_is_super_or_admin, false) THEN
    IF v_profile.last_mode_switch_at IS NOT NULL AND (now() - v_profile.last_mode_switch_at) < interval '7 days' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'MODE_SWITCH_COOLDOWN',
        'available_at', v_profile.last_mode_switch_at + interval '7 days',
        'message', format('Mode switch cooldown in effect. Available in %s days.', ceil(extract(epoch from (v_profile.last_mode_switch_at + interval '7 days' - now())) / 86400)::integer)
      );
    END IF;
  END IF;

  -- Blocker 2: Active or disputed agreements
  IF EXISTS (SELECT 1 FROM public.agreements WHERE (client_id = v_uid OR freelancer_id = v_uid) AND status IN ('active', 'disputed')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTIVE_AGREEMENTS_EXIST', 'message', 'Cannot switch modes while you have active or disputed agreements.');
  END IF;

  -- Blocker 3: Pending or disputed payments
  IF EXISTS (SELECT 1 FROM public.external_payments ep JOIN public.agreements a ON a.id = ep.agreement_id WHERE (a.client_id = v_uid OR a.freelancer_id = v_uid) AND ep.status IN ('reported_sent', 'disputed')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PENDING_PAYMENTS_EXIST', 'message', 'Cannot switch modes while payments are pending confirmation or disputed.');
  END IF;

  -- Blocker 4: Active moderation reports targeting this user
  IF EXISTS (SELECT 1 FROM public.reports WHERE target_user_id = v_uid AND status = 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PENDING_REPORTS_EXIST', 'message', 'Cannot switch modes while moderation reviews are pending.');
  END IF;

  -- Atomic clean-up of pending activities
  IF v_target = 'find_work' THEN
    UPDATE public.gigs SET status = 'cancelled' WHERE client_id = v_uid AND status IN ('open', 'draft');
  ELSE
    UPDATE public.applications SET status = 'withdrawn' WHERE freelancer_id = v_uid AND status IN ('pending', 'applied', 'countered');
  END IF;

  UPDATE public.profiles
  SET active_mode = v_target,
      last_mode_switch_at = CASE WHEN coalesce(v_profile.onboarding_completed, false) THEN now() ELSE NULL END,
      mode_changed_at = CASE WHEN coalesce(v_profile.onboarding_completed, false) THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = v_uid;

  PERFORM public.internal_log_audit(v_uid, v_profile.email, 'MODE_SWITCHED', 'SETTINGS', NULL, 'SUCCESS', jsonb_build_object('from', v_profile.active_mode, 'to', v_target));

  RETURN jsonb_build_object('ok', true, 'active_mode', v_target, 'message', 'Switched mode successfully.');
END;
$function$;

-- 5. Unified switch_mode RPC function supporting all parameter variants
DROP FUNCTION IF EXISTS public.switch_mode(text, text);
DROP FUNCTION IF EXISTS public.switch_mode(text, boolean);
DROP FUNCTION IF EXISTS public.switch_mode(text);

CREATE OR REPLACE FUNCTION public.switch_mode(
  p_target_mode text DEFAULT NULL,
  p_confirm boolean DEFAULT true,
  p_new_mode text DEFAULT NULL,
  target_mode text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $function$
DECLARE
  v_raw text := coalesce(p_target_mode, p_new_mode, target_mode);
  v_res jsonb;
BEGIN
  IF v_raw IS NULL THEN
    RAISE EXCEPTION 'Target mode is required.';
  END IF;
  v_res := public.rpc_switch_user_mode(v_raw);
  IF (v_res->>'ok')::boolean = false THEN
    RAISE EXCEPTION '%', (v_res->>'message');
  END IF;
  RETURN v_res;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.switch_mode(text, boolean, text, text) TO anon, authenticated, service_role;

-- 6. Unified choose_initial_mode RPC function supporting target_mode and p_mode
DROP FUNCTION IF EXISTS public.choose_initial_mode(text);

CREATE OR REPLACE FUNCTION public.choose_initial_mode(
  target_mode text DEFAULT NULL,
  p_mode text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $function$
DECLARE
  v_raw text := coalesce(target_mode, p_mode);
  v_mode text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF v_raw IN ('hire', 'client') THEN
    v_mode := 'hire';
  ELSIF v_raw IN ('find_work', 'freelancer') THEN
    v_mode := 'find_work';
  ELSE
    RAISE EXCEPTION 'Invalid mode: %', v_raw;
  END IF;

  UPDATE public.profiles
  SET active_mode = v_mode,
      updated_at = now()
  WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'active_mode', v_mode);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.choose_initial_mode(text, text) TO anon, authenticated, service_role;

-- 7. Update rpc_create_or_update_gig to accept both 'client' and 'hire'
CREATE OR REPLACE FUNCTION public.rpc_create_or_update_gig(
  p_gig_id uuid,
  p_title text,
  p_category text,
  p_description text,
  p_budget_centavos bigint,
  p_budget_type text,
  p_location_barangay text,
  p_required_skills text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_mode text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT active_mode INTO v_mode FROM public.profiles WHERE id = v_uid;
  IF v_mode NOT IN ('client', 'hire') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN_MODE', 'message', 'Only clients can post or edit gigs.');
  END IF;

  IF p_budget_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BUDGET', 'message', 'Budget must be greater than zero.');
  END IF;

  IF p_gig_id IS NULL THEN
    INSERT INTO public.gigs (
      client_id, title, category, description, budget_centavos, budget_type, location_barangay, required_skills
    ) VALUES (
      v_uid, trim(p_title), trim(p_category), trim(p_description), p_budget_centavos, p_budget_type, trim(p_location_barangay), p_required_skills
    ) RETURNING id INTO v_id;

    PERFORM public.internal_log_audit(v_uid, NULL, 'GIG_CREATED', 'GIGS', NULL, 'SUCCESS', jsonb_build_object('gig_id', v_id));
  ELSE
    UPDATE public.gigs
    SET title = trim(p_title), category = trim(p_category), description = trim(p_description),
        budget_centavos = p_budget_centavos, budget_type = p_budget_type, location_barangay = trim(p_location_barangay),
        required_skills = p_required_skills, updated_at = now()
    WHERE id = p_gig_id AND client_id = v_uid
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Gig not found or unauthorized.');
    END IF;

    PERFORM public.internal_log_audit(v_uid, NULL, 'GIG_UPDATED', 'GIGS', NULL, 'SUCCESS', jsonb_build_object('gig_id', v_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'gig_id', v_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_create_or_update_gig(uuid, text, text, text, bigint, text, text, text[]) TO authenticated;
