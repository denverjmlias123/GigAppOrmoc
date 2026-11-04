-- Migration 20261104000007_fix_ai_screening_and_legitimacy.sql
-- Add missing AI screening columns to profiles and declare submit_profile_verification RPC

-- 1. Missing columns on public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_legitimacy_score integer,
  ADD COLUMN IF NOT EXISTS ai_legitimacy_report jsonb,
  ADD COLUMN IF NOT EXISTS verified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS verified_by uuid;

-- 2. RPC: submit_profile_verification
CREATE OR REPLACE FUNCTION public.submit_profile_verification(
  p_score integer,
  p_report jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
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

  -- Validate score range
  IF p_score < 0 OR p_score > 100 THEN
    RAISE EXCEPTION 'invalid_score: score must be between 0 and 100' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET
    verification_status = 'ai_flagged',
    ai_legitimacy_score = p_score,
    legitimacy_score = p_score,
    ai_legitimacy_report = p_report,
    updated_at = now()
  WHERE id = v_user_id;

  -- Safe audit log
  BEGIN
    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_user_id,
      'submit_profile_verification',
      'profiles',
      v_user_id,
      jsonb_build_object('score', p_score)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Ignore audit errors
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'user_id', v_user_id,
    'verification_status', 'ai_flagged',
    'score', p_score
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_profile_verification(integer, jsonb) TO anon, authenticated, service_role;

-- 3. Robust admin_decide_verification
CREATE OR REPLACE FUNCTION public.admin_decide_verification(
  p_user_id uuid,
  p_action text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  -- Verify caller is admin
  IF NOT (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_caller)
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ACTION' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.profiles
    SET
      is_legit_verified = true,
      verification_status = 'approved',
      verified_at = now(),
      verified_by = v_caller,
      verification_notes = coalesce(p_notes, verification_notes),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF p_action = 'reject' THEN
    UPDATE public.profiles
    SET
      is_legit_verified = false,
      verification_status = 'rejected',
      verified_at = NULL,
      verified_by = v_caller,
      verification_notes = coalesce(p_notes, verification_notes),
      updated_at = now()
    WHERE id = p_user_id;
  ELSE
    RAISE EXCEPTION 'INVALID_VERIFICATION_ACTION' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'user_id', p_user_id,
    'action', p_action,
    'verified_by', v_caller
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_decide_verification(uuid, text, text) TO anon, authenticated, service_role;

-- 4. Reload Schema Cache
NOTIFY pgrst, 'reload schema';
