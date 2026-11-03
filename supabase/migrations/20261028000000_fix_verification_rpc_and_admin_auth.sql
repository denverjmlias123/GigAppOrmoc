-- Migration 20261028000000: Fix verification RPC authorization and add profile verification submission RPC
-- Fixes admin_decide_verification to verify caller in public.platform_admins instead of public.profiles.admin_role
-- Adds submit_profile_verification RPC so users can submit their profile for AI verification without direct table updates

-- 1. Fix admin_decide_verification
CREATE OR REPLACE FUNCTION public.admin_decide_verification(
  p_user_id uuid,
  p_action text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_role text;
  v_res jsonb;
BEGIN
  -- Verify caller is admin or super_admin from platform_admins (not profiles)
  SELECT role INTO v_admin_role
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  IF v_admin_role IS NULL OR v_admin_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ACTION' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.profiles
    SET
      is_legit_verified = true,
      verification_status = 'approved',
      verified_at = now(),
      verified_by = auth.uid(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF p_action = 'reject' THEN
    UPDATE public.profiles
    SET
      is_legit_verified = false,
      verification_status = 'rejected',
      verified_at = NULL,
      verified_by = auth.uid(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSE
    RAISE EXCEPTION 'INVALID_VERIFICATION_ACTION' USING ERRCODE = '22023';
  END IF;

  -- Log to audit_events
  INSERT INTO public.audit_events (
    actor_id,
    action,
    target_type,
    target_id,
    details,
    created_at
  ) VALUES (
    auth.uid(),
    'admin_verification_decision',
    'profile',
    p_user_id,
    jsonb_build_object('action', p_action, 'notes', p_notes, 'admin_role', v_admin_role),
    now()
  );

  v_res := jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'action', p_action,
    'verified_by', auth.uid()
  );

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_decide_verification(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_verification(uuid, text, text) TO authenticated;

-- 2. Add submit_profile_verification RPC for self-submission by active users
CREATE OR REPLACE FUNCTION public.submit_profile_verification(
  p_score integer,
  p_report jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'account_not_active' USING ERRCODE = '42501';
  END IF;

  -- Validate score range
  IF p_score < 0 OR p_score > 100 THEN
    RAISE EXCEPTION 'invalid_score: score must be between 0 and 100' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET
    verification_status = 'ai_flagged',
    ai_legitimacy_score = p_score,
    ai_legitimacy_report = p_report,
    updated_at = now()
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'verification_status', 'ai_flagged',
    'score', p_score
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_profile_verification(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_profile_verification(integer, jsonb) TO authenticated;
