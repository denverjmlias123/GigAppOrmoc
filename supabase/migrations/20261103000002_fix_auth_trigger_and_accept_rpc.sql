-- ============================================================================
-- Migration: Auth User Trigger & Application Accept RPC Fix
-- ============================================================================

-- 1. Create or update handle_new_user() trigger on auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
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
    NEW.id, v_username, v_email, v_display_name, v_dob, 'freelancer', (NEW.email_confirmed_at IS NOT NULL), false, 1
  ) ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(nullif(EXCLUDED.display_name, ''), public.profiles.display_name);

  INSERT INTO public.login_security_state (user_id, failed_attempts, lockout_tier, captcha_required)
  VALUES (NEW.id, 0, 0, false)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- Backfill any existing users in auth.users missing from profiles
INSERT INTO public.profiles (
  id, username, email, display_name, date_of_birth, active_mode, email_verified, onboarding_completed, onboarding_step
)
SELECT 
  u.id,
  lower(regexp_replace(split_part(u.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g')) || '_' || substr(replace(u.id::text, '-', ''), 1, 6),
  lower(trim(u.email)),
  coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''), split_part(u.email, '@', 1)),
  '2000-01-01'::date,
  'freelancer',
  (u.email_confirmed_at IS NOT NULL),
  false,
  1
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- 2. Update rpc_accept_application to provide a default for p_terms_summary
CREATE OR REPLACE FUNCTION public.rpc_accept_application(
  p_application_id uuid,
  p_terms_summary text DEFAULT 'Standard freelance agreement terms.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app public.applications%ROWTYPE;
  v_gig public.gigs%ROWTYPE;
  v_agr_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_app FROM public.applications WHERE id = p_application_id FOR UPDATE;
  IF v_app.id IS NULL OR v_app.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_APPLICATION', 'message', 'Application is not available to accept.');
  END IF;

  SELECT * INTO v_gig FROM public.gigs WHERE id = v_app.gig_id;
  IF v_gig.client_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only the gig owner can accept proposals.');
  END IF;

  UPDATE public.applications SET status = 'accepted' WHERE id = p_application_id;
  UPDATE public.applications SET status = 'rejected' WHERE gig_id = v_app.gig_id AND id != p_application_id AND status = 'pending';
  UPDATE public.gigs SET status = 'in_progress' WHERE id = v_app.gig_id;

  INSERT INTO public.agreements (
    gig_id, application_id, client_id, freelancer_id, total_amount_centavos, terms_summary, status
  ) VALUES (
    v_app.gig_id, p_application_id, v_uid, v_app.freelancer_id, v_app.proposed_rate_centavos, coalesce(p_terms_summary, 'Standard freelance agreement terms.'), 'active'
  ) RETURNING id INTO v_agr_id;

  -- Ensure 1-on-1 conversation exists
  INSERT INTO public.conversations (gig_id, application_id, agreement_id, client_id, freelancer_id)
  VALUES (v_app.gig_id, p_application_id, v_agr_id, v_uid, v_app.freelancer_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
  VALUES (v_app.freelancer_id, 'Proposal Accepted!', 'Your proposal was accepted. Agreement is now active.', 'agreement_started', '/agreements/' || v_agr_id);

  PERFORM public.internal_log_audit(v_uid, NULL, 'AGREEMENT_CREATED', 'AGREEMENTS', NULL, 'SUCCESS', jsonb_build_object('agreement_id', v_agr_id));

  RETURN jsonb_build_object('ok', true, 'agreement_id', v_agr_id);
END;
$$;

-- 3. respond_to_application wrapper
CREATE OR REPLACE FUNCTION public.respond_to_application(
  p_application_id uuid,
  p_action text,
  p_counter_price bigint DEFAULT NULL,
  p_request_id text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF p_action = 'accept' THEN
    v_res := public.rpc_accept_application(p_application_id, 'Standard freelance agreement terms.');
    IF (v_res->>'ok')::boolean = false THEN
      RAISE EXCEPTION '%', (v_res->>'message');
    END IF;
    RETURN v_res->>'agreement_id';
  ELSIF p_action = 'decline' THEN
    UPDATE public.applications SET status = 'rejected' WHERE id = p_application_id;
    RETURN NULL;
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

-- 4. Messaging functions with client_id / freelancer_id
CREATE OR REPLACE FUNCTION public.get_user_conversations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'gig_id', c.gig_id,
      'agreement_id', c.agreement_id,
      'client_id', c.client_id,
      'freelancer_id', c.freelancer_id,
      'other_user_id', CASE WHEN c.client_id = v_uid THEN c.freelancer_id ELSE c.client_id END,
      'last_message_at', c.last_message_at,
      'created_at', c.created_at
    ) ORDER BY c.last_message_at DESC NULLS LAST
  ), '[]'::jsonb) INTO v_res
  FROM public.conversations c
  WHERE c.client_id = v_uid OR c.freelancer_id = v_uid;

  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.conversations
  WHERE (client_id = v_uid AND freelancer_id = p_other_user_id)
     OR (client_id = p_other_user_id AND freelancer_id = v_uid)
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.conversations (client_id, freelancer_id)
    VALUES (v_uid, p_other_user_id)
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_accept_application(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_application(uuid, text, bigint, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_conversations() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) TO anon, authenticated, service_role;
