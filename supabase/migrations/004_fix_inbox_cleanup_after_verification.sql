-- ============================================================================
-- Fix project inbox messages returning used or expired OTP challenges
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_project_inbox_messages(
  p_recipient_email text DEFAULT NULL,
  p_challenge_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    -- Authenticated user: only return messages whose OTP challenge is still active & unexpired
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'subject', m.subject,
        'recipient_email', m.recipient_email,
        'purpose', m.purpose,
        'otp_code_display', m.otp_code_display,
        'expires_at', m.expires_at,
        'is_read', m.is_read,
        'created_at', m.created_at
      ) ORDER BY m.created_at DESC
    ) INTO v_res
    FROM public.project_inbox_messages m
    JOIN public.otp_challenges c ON c.id = m.otp_challenge_id
    WHERE m.user_id = auth.uid()
      AND c.status IN ('active', 'verified')
      AND c.expires_at > now();
  ELSE
    -- Unauthenticated: Requires BOTH valid challenge_id AND recipient_email match
    IF p_challenge_id IS NULL OR p_recipient_email IS NULL THEN
      RETURN '[]'::jsonb;
    END IF;

    SELECT jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'subject', m.subject,
        'recipient_email', m.recipient_email,
        'purpose', m.purpose,
        'otp_code_display', m.otp_code_display,
        'expires_at', m.expires_at,
        'is_read', m.is_read,
        'created_at', m.created_at
      ) ORDER BY m.created_at DESC
    ) INTO v_res
    FROM public.project_inbox_messages m
    JOIN public.otp_challenges c ON c.id = m.otp_challenge_id
    WHERE m.otp_challenge_id = p_challenge_id
      AND lower(m.recipient_email) = lower(trim(p_recipient_email))
      AND c.status IN ('active', 'verified')
      AND c.expires_at > now()
      AND c.purpose IN ('signup_verification', 'password_reset');
  END IF;

  RETURN coalesce(v_res, '[]'::jsonb);
END;
$$;
