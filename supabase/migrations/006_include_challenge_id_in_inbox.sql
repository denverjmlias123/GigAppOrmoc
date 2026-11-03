-- ============================================================================
-- Migration 006: Include otp_challenge_id in Project Inbox Messages
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
  IF p_recipient_email IS NULL AND p_challenge_id IS NULL AND auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'otp_challenge_id', m.otp_challenge_id,
      'subject', m.subject,
      'recipient_email', m.recipient_email,
      'purpose', m.purpose,
      'otp_code_display', m.otp_code_display,
      'expires_at', m.expires_at,
      'is_read', m.is_read,
      'created_at', m.created_at
    ) ORDER BY m.created_at DESC
  ), '[]'::jsonb) INTO v_res
  FROM public.project_inbox_messages m
  JOIN public.otp_challenges c ON c.id = m.otp_challenge_id
  WHERE (
      (auth.uid() IS NOT NULL AND m.user_id = auth.uid())
      OR (p_challenge_id IS NOT NULL AND m.otp_challenge_id = p_challenge_id)
      OR (p_recipient_email IS NOT NULL AND lower(m.recipient_email) = lower(trim(p_recipient_email)))
    )
    AND c.status IN ('active', 'verified')
    AND c.expires_at > now();

  RETURN coalesce(v_res, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_project_inbox_messages TO anon, authenticated, service_role;
