-- ============================================================================
-- Migration 005: Resilient Project Mail Inbox & Registration Recovery
-- ============================================================================

-- Clean up any orphaned unconfirmed auth users with no profiles
DELETE FROM auth.users 
WHERE lower(email) IN ('freelancer@example.com')
  AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.users.id);

-- 1. Resilient rpc_get_project_inbox_messages
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

-- 2. Resilient rpc_generate_otp
CREATE OR REPLACE FUNCTION public.rpc_generate_otp(
  p_identifier text,
  p_purpose text,
  p_target_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid;
  v_em text;
  v_last_challenge record;
  v_otp_code text;
  v_challenge_id uuid;
  v_expires_at timestamptz := now() + interval '5 minutes';
  v_resend_at timestamptz := now() + interval '60 seconds';
BEGIN
  IF p_purpose NOT IN ('signup_verification', 'password_reset', 'email_change') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_PURPOSE', 'message', 'Invalid OTP purpose.');
  END IF;

  -- Resolve user
  IF p_purpose = 'email_change' THEN
    v_user_id := auth.uid();
    v_em := lower(trim(p_target_email));
  ELSE
    SELECT id, email INTO v_user_id, v_em
    FROM public.profiles
    WHERE lower(username) = lower(trim(p_identifier)) OR lower(email) = lower(trim(p_identifier));

    IF v_user_id IS NULL AND p_target_email IS NOT NULL THEN
      v_em := lower(trim(p_target_email));
    END IF;
  END IF;

  IF v_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND', 'message', 'Account not found.');
  END IF;

  -- Check cooldown: if cooldown is active, return RESEND_COOLDOWN but include active challenge_id!
  SELECT * INTO v_last_challenge
  FROM public.otp_challenges
  WHERE lower(target_email) = v_em AND purpose = p_purpose AND status = 'active' AND expires_at > now()
  ORDER BY created_at DESC LIMIT 1;

  IF v_last_challenge.id IS NOT NULL AND now() < v_last_challenge.resend_available_at THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'RESEND_COOLDOWN',
      'challenge_id', v_last_challenge.id,
      'resend_available_at', v_last_challenge.resend_available_at,
      'message', 'Please wait before requesting another verification code.'
    );
  END IF;

  -- Invalidate prior active challenges for this target
  UPDATE public.otp_challenges
  SET status = 'invalidated'
  WHERE lower(target_email) = v_em AND purpose = p_purpose AND status = 'active';

  -- Generate new 6-digit OTP
  v_otp_code := (floor(random() * 900000 + 100000)::integer)::text;

  INSERT INTO public.otp_challenges (
    user_id,
    target_email,
    purpose,
    otp_hash,
    attempts_used,
    expires_at,
    resend_available_at,
    status
  ) VALUES (
    v_user_id,
    v_em,
    p_purpose,
    crypt(v_otp_code, gen_salt('bf', 8)),
    0,
    v_expires_at,
    v_resend_at,
    'active'
  ) RETURNING id INTO v_challenge_id;

  INSERT INTO public.project_inbox_messages (
    user_id,
    otp_challenge_id,
    recipient_email,
    purpose,
    subject,
    otp_code_display,
    expires_at
  ) VALUES (
    v_user_id,
    v_challenge_id,
    v_em,
    p_purpose,
    CASE 
      WHEN p_purpose = 'signup_verification' THEN 'Verify your GigOrmoc Account'
      WHEN p_purpose = 'password_reset' THEN 'Reset your GigOrmoc Password'
      ELSE 'Confirm your Email Change'
    END,
    v_otp_code,
    v_expires_at
  );

  RETURN jsonb_build_object(
    'ok', true,
    'challenge_id', v_challenge_id,
    'target_email', v_em,
    'otp_code_display', v_otp_code,
    'expires_at', v_expires_at,
    'resend_available_at', v_resend_at,
    'message', 'New 6-digit code delivered to Project Mail Inbox.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_generate_otp TO anon, authenticated, service_role;

-- 3. Resilient rpc_register_and_issue_otp
CREATE OR REPLACE FUNCTION public.rpc_register_and_issue_otp(
  p_username text,
  p_display_name text,
  p_email text,
  p_password text,
  p_dob date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uname text := lower(trim(p_username));
  v_em text := lower(trim(p_email));
  v_user_id uuid;
  v_existing_profile record;
  v_otp_code text;
  v_challenge_id uuid;
  v_expires_at timestamptz := now() + interval '5 minutes';
  v_resend_at timestamptz := now() + interval '60 seconds';
BEGIN
  -- 18+ Date of Birth enforcement
  IF age(current_date, p_dob) < interval '18 years' THEN
    PERFORM public.internal_log_audit(
      NULL,
      v_em,
      'USER_SIGNUP_REJECTED_UNDERAGE',
      'AUTH',
      NULL,
      'BLOCKED',
      jsonb_build_object('dob', p_dob, 'reason', 'User is under 18 years old')
    );
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'UNDERAGE_18_PLUS',
      'message', 'You must be at least 18 years old to register on GigOrmoc.'
    );
  END IF;

  -- Validate password complexity
  IF length(p_password) < 8 OR
     p_password !~ '[A-Z]' OR
     p_password !~ '[a-z]' OR
     p_password !~ '[0-9]' OR
     p_password !~ '[^a-zA-Z0-9]' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PASSWORD_COMPLEXITY_FAILED',
      'message', 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
    );
  END IF;

  -- Clean up any orphaned unconfirmed auth.users row with no profile for this email
  DELETE FROM auth.users 
  WHERE lower(email) = v_em 
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.users.id);

  -- Check if profile already exists
  SELECT * INTO v_existing_profile 
  FROM public.profiles 
  WHERE lower(username) = v_uname OR lower(email) = v_em 
  LIMIT 1;

  IF v_existing_profile.id IS NOT NULL THEN
    IF v_existing_profile.email_verified THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'ACCOUNT_ALREADY_EXISTS',
        'message', 'An account with this username or email already exists.'
      );
    ELSE
      -- Profile exists but is not yet verified: re-issue verification challenge
      v_user_id := v_existing_profile.id;
      
      -- Update password in auth.users
      UPDATE auth.users 
      SET encrypted_password = crypt(p_password, gen_salt('bf', 10)),
          updated_at = now()
      WHERE id = v_user_id;

      -- Invalidate prior challenges
      UPDATE public.otp_challenges
      SET status = 'invalidated'
      WHERE lower(target_email) = v_em AND purpose = 'signup_verification' AND status = 'active';

      v_otp_code := (floor(random() * 900000 + 100000)::integer)::text;

      INSERT INTO public.otp_challenges (
        user_id,
        target_email,
        purpose,
        otp_hash,
        attempts_used,
        expires_at,
        resend_available_at,
        status
      ) VALUES (
        v_user_id,
        v_em,
        'signup_verification',
        crypt(v_otp_code, gen_salt('bf', 8)),
        0,
        v_expires_at,
        v_resend_at,
        'active'
      ) RETURNING id INTO v_challenge_id;

      INSERT INTO public.project_inbox_messages (
        user_id,
        otp_challenge_id,
        recipient_email,
        purpose,
        subject,
        otp_code_display,
        expires_at
      ) VALUES (
        v_user_id,
        v_challenge_id,
        v_em,
        'signup_verification',
        'Verify your GigOrmoc Account',
        v_otp_code,
        v_expires_at
      );

      RETURN jsonb_build_object(
        'ok', true,
        'user_id', v_user_id,
        'email', v_em,
        'challenge_id', v_challenge_id,
        'expires_at', v_expires_at,
        'resend_available_at', v_resend_at,
        'message', 'Registration updated. 6-digit OTP delivered to Project Mail Inbox.'
      );
    END IF;
  END IF;

  -- Fresh user creation
  v_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_em,
    crypt(p_password, gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_uname, 'display_name', p_display_name),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_em),
    'email',
    v_user_id::text,
    now(),
    now(),
    now()
  );

  INSERT INTO public.profiles (
    id,
    username,
    email,
    display_name,
    date_of_birth,
    email_verified,
    onboarding_completed,
    onboarding_step
  ) VALUES (
    v_user_id,
    v_uname,
    v_em,
    trim(p_display_name),
    p_dob,
    false,
    false,
    1
  );

  INSERT INTO public.login_security_state (
    user_id,
    failed_attempts,
    lockout_tier,
    captcha_required
  ) VALUES (
    v_user_id,
    0,
    0,
    false
  );

  v_otp_code := (floor(random() * 900000 + 100000)::integer)::text;

  INSERT INTO public.otp_challenges (
    user_id,
    target_email,
    purpose,
    otp_hash,
    attempts_used,
    expires_at,
    resend_available_at,
    status
  ) VALUES (
    v_user_id,
    v_em,
    'signup_verification',
    crypt(v_otp_code, gen_salt('bf', 8)),
    0,
    v_expires_at,
    v_resend_at,
    'active'
  ) RETURNING id INTO v_challenge_id;

  INSERT INTO public.project_inbox_messages (
    user_id,
    otp_challenge_id,
    recipient_email,
    purpose,
    subject,
    otp_code_display,
    expires_at
  ) VALUES (
    v_user_id,
    v_challenge_id,
    v_em,
    'signup_verification',
    'Verify your GigOrmoc Account',
    v_otp_code,
    v_expires_at
  );

  PERFORM public.internal_log_audit(
    v_user_id,
    v_em,
    'USER_SIGNUP_COMPLETED',
    'AUTH',
    NULL,
    'SUCCESS',
    jsonb_build_object('username', v_uname, 'challenge_id', v_challenge_id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'email', v_em,
    'challenge_id', v_challenge_id,
    'expires_at', v_expires_at,
    'resend_available_at', v_resend_at,
    'message', 'Registration successful. 6-digit OTP delivered to Project Mail Inbox.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_register_and_issue_otp TO anon, authenticated, service_role;
