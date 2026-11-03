-- Milestone: Legitimacy Badge & AI-Assisted Super Admin Verification

-- 1. Add verification and AI screening columns to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_legit_verified boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified', 'ai_flagged', 'approved', 'rejected')),
ADD COLUMN IF NOT EXISTS ai_legitimacy_score integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_legitimacy_report jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS verified_at timestamptz DEFAULT NULL,
ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) DEFAULT NULL;

-- Index for quick lookups on the verification queue
CREATE INDEX IF NOT EXISTS idx_profiles_verification_status
ON public.profiles(verification_status, created_at DESC);

-- 2. RPC for Super Admin to decide account legitimacy
CREATE OR REPLACE FUNCTION public.admin_decide_verification(
  p_user_id uuid,
  p_action text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_role text;
  v_res jsonb;
BEGIN
  -- Verify caller is admin or super_admin
  SELECT admin_role INTO v_admin_role
  FROM public.profiles
  WHERE id = auth.uid();

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

  -- Record in audit log if audit log table exists
  BEGIN
    INSERT INTO public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      status,
      metadata
    ) VALUES (
      auth.uid(),
      CASE WHEN p_action = 'approve' THEN 'legit_badge_approved' ELSE 'legit_badge_rejected' END,
      'profile',
      p_user_id,
      'success',
      jsonb_build_object('notes', p_notes, 'admin_role', v_admin_role)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Non-blocking if audit_logs schema differs
  END;

  SELECT jsonb_build_object(
    'user_id', p_user_id,
    'action', p_action,
    'is_legit_verified', (p_action = 'approve'),
    'verification_status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END
  ) INTO v_res;

  RETURN v_res;
END;
$$;
