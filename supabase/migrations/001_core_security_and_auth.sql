-- ============================================================================
-- GIGORMOC LOCAL FREELANCE MARKETPLACE & SECURITY ARCHITECTURE
-- Migration 001: Core Security, Authentication, Inactivity & Audit Trail
-- Implements IAS 1 Parts A, B, C, D, E, F, G, H & AppDev 4th Increment
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. CORE TABLES
-- ----------------------------------------------------------------------------

-- 1.1 PROFILES (Application identity & mode state)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  email text UNIQUE NOT NULL,
  display_name text NOT NULL,
  date_of_birth date NOT NULL,
  phone text,
  active_mode text NOT NULL DEFAULT 'freelancer' CHECK (active_mode IN ('freelancer', 'client')),
  last_mode_switch_at timestamptz,
  email_verified boolean NOT NULL DEFAULT false,
  onboarding_completed boolean NOT NULL DEFAULT false,
  onboarding_step integer NOT NULL DEFAULT 1 CHECK (onboarding_step BETWEEN 1 AND 3),
  is_active boolean NOT NULL DEFAULT true,
  is_admin_locked boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unsubmitted' CHECK (verification_status IN ('unsubmitted', 'pending', 'update_requested', 'verified', 'rejected')),
  legitimacy_score integer NOT NULL DEFAULT 0 CHECK (legitimacy_score BETWEEN 0 AND 100),
  verification_notes text,
  area_barangay text,
  bio text,
  avatar_url text,
  client_type text CHECK (client_type IS NULL OR client_type IN ('individual', 'business')),
  business_name text,
  hiring_interests text[] DEFAULT '{}',
  freelancer_rating_avg numeric(3, 2) NOT NULL DEFAULT 0.00 CHECK (freelancer_rating_avg BETWEEN 0.00 AND 5.00),
  freelancer_review_count integer NOT NULL DEFAULT 0 CHECK (freelancer_review_count >= 0),
  client_rating_avg numeric(3, 2) NOT NULL DEFAULT 0.00 CHECK (client_rating_avg BETWEEN 0.00 AND 5.00),
  client_review_count integer NOT NULL DEFAULT 0 CHECK (client_review_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1.2 LOGIN SECURITY STATE (3-Strike 1m/5m/15m lockout & Visual CAPTCHA)
CREATE TABLE IF NOT EXISTS public.login_security_state (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  lockout_tier integer NOT NULL DEFAULT 0 CHECK (lockout_tier >= 0),
  locked_until timestamptz,
  captcha_required boolean NOT NULL DEFAULT false,
  active_captcha_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1.3 OTP CHALLENGES (Self-hosted 6-digit OTP engine)
CREATE TABLE IF NOT EXISTS public.otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('signup_verification', 'password_reset', 'email_change')),
  otp_hash text NOT NULL,
  attempts_used integer NOT NULL DEFAULT 0 CHECK (attempts_used BETWEEN 0 AND 3),
  expires_at timestamptz NOT NULL,
  resend_available_at timestamptz NOT NULL,
  consumed_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'verified', 'used', 'invalidated', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.4 PROJECT INBOX MESSAGES (In-app Push Banner & Pull-Down Drawer without external SMTP)
CREATE TABLE IF NOT EXISTS public.project_inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  otp_challenge_id uuid REFERENCES public.otp_challenges(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  purpose text NOT NULL,
  subject text NOT NULL,
  otp_code_display text NOT NULL,
  expires_at timestamptz NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.5 USER SESSIONS (Multi-tab synchronization & 15-minute idle tracking)
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_token_fingerprint text,
  device_info text,
  ip_address text,
  is_revoked boolean NOT NULL DEFAULT false,
  revoked_reason text,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.6 PLATFORM ADMINS (Administrative authorization tier)
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'super_admin')),
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.7 AUDIT EVENTS (Append-only security & operations log trail)
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid, -- Loose UUID: no FK constraint to profiles so audit trail survives restores
  actor_identifier text,
  activity text NOT NULL,
  affected_module text NOT NULL CHECK (affected_module IN ('AUTH', 'ONBOARDING', 'GIGS', 'AGREEMENTS', 'CHAT', 'PROFILE', 'DISPUTES', 'SETTINGS', 'ADMIN', 'BACKUP')),
  ip_address text,
  result text NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE', 'LOCKED', 'BLOCKED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.8 DATABASE BACKUPS (JSONB snapshots preserving audit events)
CREATE TABLE IF NOT EXISTS public.database_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_admin_id uuid, -- Loose UUID: no FK constraint to profiles
  created_by_identifier text,
  backup_type text NOT NULL CHECK (backup_type IN ('scheduled', 'manual', 'pre_restore')),
  label text,
  checksum_sha256 text NOT NULL,
  table_row_counts jsonb NOT NULL,
  snapshot_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. IMMUTABILITY & SECURITY TRIGGERS
-- ----------------------------------------------------------------------------

-- Enforce strict immutability on public.audit_events
CREATE OR REPLACE FUNCTION public.trg_audit_events_immutable_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PERMISSION DENIED: public.audit_events is append-only. Updates and deletions are strictly prohibited (IAS 1 Checklist F).';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON public.audit_events;
CREATE TRIGGER trg_audit_events_immutable
BEFORE UPDATE OR DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_events_immutable_fn();

-- Revoke mutation permissions
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_events FROM anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. INTERNAL HELPER FUNCTIONS
-- ----------------------------------------------------------------------------

-- Internal helper to safely append to audit_events without exception abort
CREATE OR REPLACE FUNCTION public.internal_log_audit(
  p_actor_id uuid,
  p_actor_identifier text,
  p_activity text,
  p_module text,
  p_ip text,
  p_result text,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  INSERT INTO public.audit_events (
    actor_user_id,
    actor_identifier,
    activity,
    affected_module,
    ip_address,
    result,
    metadata
  ) VALUES (
    p_actor_id,
    p_actor_identifier,
    p_activity,
    p_module,
    p_ip,
    p_result,
    coalesce(p_meta, '{}'::jsonb)
  );
END;
$$;

-- Server-side session and lockout validity check
CREATE OR REPLACE FUNCTION public.is_authenticated_session_valid()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    LEFT JOIN public.login_security_state lss ON lss.user_id = p.id
    JOIN public.user_sessions us ON us.user_id = p.id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.is_admin_locked = false
      AND (lss.locked_until IS NULL OR lss.locked_until <= now())
      AND us.is_revoked = false
      AND us.last_active_at >= now() - interval '15 minutes'
  );
END;
$$;

-- Server-side admin authorization check (SECURITY DEFINER prevents RLS recursion on platform_admins)
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. ROW-LEVEL SECURITY POLICIES (001 Tables)
-- ----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_security_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.database_backups ENABLE ROW LEVEL SECURITY;

-- Profiles: Own user can view own full profile; Admins can view all; Others read through rpc_get_public_profile
CREATE POLICY profiles_select_policy ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR public.is_platform_admin(auth.uid())
);

CREATE POLICY profiles_update_policy ON public.profiles
FOR UPDATE USING (
  id = auth.uid() AND public.is_authenticated_session_valid()
);

-- User Sessions: User can see own sessions
CREATE POLICY sessions_select_policy ON public.user_sessions
FOR SELECT USING (user_id = auth.uid());

-- Project Inbox Messages: User can read own messages
CREATE POLICY inbox_select_policy ON public.project_inbox_messages
FOR SELECT USING (user_id = auth.uid());

-- Platform Admins: Admins can view admin membership; non-admins can view their own record
CREATE POLICY admins_select_policy ON public.platform_admins
FOR SELECT USING (
  user_id = auth.uid() OR public.is_platform_admin(auth.uid())
);

-- Audit Events: Platform admins can view log trail
CREATE POLICY audit_events_select_policy ON public.audit_events
FOR SELECT USING (
  public.is_platform_admin(auth.uid())
);

-- Database Backups: Platform admins can view backups
CREATE POLICY backups_select_policy ON public.database_backups
FOR SELECT USING (
  public.is_platform_admin(auth.uid())
);

-- ----------------------------------------------------------------------------
-- 5. REALTIME PUBLICATIONS
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'project_inbox_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_inbox_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. SECURITY DEFINER RPCS (AUTH, OTP, LOCKOUT, CAPTCHA, SESSIONS)
-- ----------------------------------------------------------------------------

-- 6.1 rpc_check_signup_availability
CREATE OR REPLACE FUNCTION public.rpc_check_signup_availability(
  p_username text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uname text := lower(trim(coalesce(p_username, '')));
  v_em text := lower(trim(coalesce(p_email, '')));
  v_uname_avail boolean := true;
  v_em_avail boolean := true;
BEGIN
  IF v_uname !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_USERNAME_FORMAT',
      'message', 'Username must be 3-20 lowercase alphanumeric characters or underscores.'
    );
  END IF;

  IF v_em !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_EMAIL_FORMAT',
      'message', 'Please enter a syntactically valid email address.'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v_uname) THEN
    v_uname_avail := false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = v_em) THEN
    v_em_avail := false;
  END IF;

  IF NOT v_uname_avail OR NOT v_em_avail THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'IDENTIFIER_TAKEN',
      'username_available', v_uname_avail,
      'email_available', v_em_avail,
      'message', CASE 
        WHEN NOT v_uname_avail AND NOT v_em_avail THEN 'Both username and email are already registered.'
        WHEN NOT v_uname_avail THEN 'This username is already taken.'
        ELSE 'This email address is already registered.'
      END
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'username_available', true,
    'email_available', true,
    'message', 'Username and email are available.'
  );
END;
$$;

-- 6.2 rpc_register_and_issue_otp
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
  v_user_id uuid := gen_random_uuid();
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

  -- Validate password complexity (>=8 chars, upper, lower, number, special)
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

  -- Ensure uniqueness
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v_uname OR lower(email) = v_em) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'ACCOUNT_ALREADY_EXISTS',
      'message', 'An account with this username or email already exists.'
    );
  END IF;

  -- Create canonical GoTrue auth user directly with mandatory v2+ non-null columns
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
    now(), -- Bypasses external SMTP requirement
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_uname, 'display_name', p_display_name),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  -- Link auth.identities
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

  -- Insert public.profiles
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

  -- Insert public.login_security_state
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

  -- Generate 6-digit OTP
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

  -- Insert in-app demo mail message
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

  -- Log audit event
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

-- 6.3 rpc_generate_otp
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

  -- Check cooldown
  SELECT * INTO v_last_challenge
  FROM public.otp_challenges
  WHERE lower(target_email) = v_em AND purpose = p_purpose AND status = 'active'
  ORDER BY created_at DESC LIMIT 1;

  IF v_last_challenge.id IS NOT NULL AND now() < v_last_challenge.resend_available_at THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'RESEND_COOLDOWN',
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
    CASE p_purpose
      WHEN 'signup_verification' THEN 'Verify your GigOrmoc Account'
      WHEN 'password_reset' THEN 'Reset your GigOrmoc Password'
      WHEN 'email_change' THEN 'Confirm your New Email Address'
      ELSE 'GigOrmoc Security Code'
    END,
    v_otp_code,
    v_expires_at
  );

  PERFORM public.internal_log_audit(
    v_user_id,
    v_em,
    'OTP_GENERATED',
    'AUTH',
    NULL,
    'SUCCESS',
    jsonb_build_object('purpose', p_purpose, 'challenge_id', v_challenge_id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'challenge_id', v_challenge_id,
    'target_email', v_em,
    'expires_at', v_expires_at,
    'resend_available_at', v_resend_at,
    'message', 'New 6-digit code delivered to Project Mail Inbox.'
  );
END;
$$;

-- 6.4 rpc_get_project_inbox_messages (Tightened against unauthenticated scraping)
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

-- 6.5 rpc_verify_otp
CREATE OR REPLACE FUNCTION public.rpc_verify_otp(
  p_challenge_id uuid,
  p_otp_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_ch public.otp_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_ch
  FROM public.otp_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF v_ch.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OTP_NOT_FOUND', 'message', 'Verification challenge not found.');
  END IF;

  IF v_ch.status != 'active' OR v_ch.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OTP_ALREADY_USED_OR_INVALID', 'message', 'This code has already been used or invalidated.');
  END IF;

  IF now() > v_ch.expires_at THEN
    UPDATE public.otp_challenges SET status = 'expired' WHERE id = v_ch.id;
    PERFORM public.internal_log_audit(v_ch.user_id, v_ch.target_email, 'OTP_FAILED', 'AUTH', NULL, 'FAILURE', jsonb_build_object('reason', 'expired'));
    RETURN jsonb_build_object('ok', false, 'code', 'OTP_EXPIRED', 'message', 'Verification code has expired. Please request a new one.');
  END IF;

  -- Validate OTP code
  IF v_ch.otp_hash != crypt(trim(p_otp_code), v_ch.otp_hash) THEN
    v_ch.attempts_used := v_ch.attempts_used + 1;
    IF v_ch.attempts_used >= 3 THEN
      UPDATE public.otp_challenges
      SET attempts_used = v_ch.attempts_used, status = 'invalidated'
      WHERE id = v_ch.id;
      PERFORM public.internal_log_audit(v_ch.user_id, v_ch.target_email, 'OTP_INVALIDATED', 'AUTH', NULL, 'BLOCKED', jsonb_build_object('attempts_used', v_ch.attempts_used));
      RETURN jsonb_build_object('ok', false, 'code', 'OTP_MAX_ATTEMPTS_EXCEEDED', 'remaining_attempts', 0, 'message', 'Maximum wrong attempts exceeded. This code is invalidated.');
    ELSE
      UPDATE public.otp_challenges
      SET attempts_used = v_ch.attempts_used
      WHERE id = v_ch.id;
      PERFORM public.internal_log_audit(v_ch.user_id, v_ch.target_email, 'OTP_FAILED', 'AUTH', NULL, 'FAILURE', jsonb_build_object('attempts_used', v_ch.attempts_used));
      RETURN jsonb_build_object('ok', false, 'code', 'OTP_MISMATCH', 'remaining_attempts', 3 - v_ch.attempts_used, 'message', format('Incorrect code. %s attempt(s) remaining.', 3 - v_ch.attempts_used));
    END IF;
  END IF;

  -- On match: branch by purpose
  IF v_ch.purpose = 'password_reset' THEN
    -- Transition to verified for Stage 3 consumption
    UPDATE public.otp_challenges
    SET status = 'verified'
    WHERE id = v_ch.id;
  ELSE
    -- signup_verification or email_change consumed immediately
    UPDATE public.otp_challenges
    SET status = 'used', consumed_at = now()
    WHERE id = v_ch.id;

    IF v_ch.purpose = 'signup_verification' AND v_ch.user_id IS NOT NULL THEN
      UPDATE public.profiles SET email_verified = true WHERE id = v_ch.user_id;
      UPDATE auth.users SET email_confirmed_at = now() WHERE id = v_ch.user_id;
    END IF;
  END IF;

  PERFORM public.internal_log_audit(v_ch.user_id, v_ch.target_email, 'OTP_VERIFIED', 'AUTH', NULL, 'SUCCESS', jsonb_build_object('purpose', v_ch.purpose));

  RETURN jsonb_build_object(
    'ok', true,
    'purpose', v_ch.purpose,
    'user_id', v_ch.user_id,
    'target_email', v_ch.target_email,
    'message', 'Code verified successfully.'
  );
END;
$$;

-- 6.6 rpc_generate_captcha
CREATE OR REPLACE FUNCTION public.rpc_generate_captcha(p_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_i integer;
  v_user_id uuid;
BEGIN
  FOR v_i IN 1..6 LOOP
    v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::integer, 1);
  END LOOP;

  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE lower(username) = lower(trim(p_identifier)) OR lower(email) = lower(trim(p_identifier));

  IF v_user_id IS NOT NULL THEN
    UPDATE public.login_security_state
    SET active_captcha_hash = crypt(upper(v_code), gen_salt('bf', 8)), updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'captcha_code', v_code
  );
END;
$$;

-- 6.7 rpc_verify_credentials_and_gate (With 3-Strike Lockout & Single-Use CAPTCHA)
CREATE OR REPLACE FUNCTION public.rpc_verify_credentials_and_gate(
  p_identifier text,
  p_password text,
  p_captcha_input text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_lss public.login_security_state%ROWTYPE;
  v_enc_pass text;
  v_lock_interval interval;
  v_active_captcha_matched boolean := false;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE lower(username) = lower(trim(p_identifier)) OR lower(email) = lower(trim(p_identifier));

  IF v_profile.id IS NULL THEN
    -- Account does not exist
    PERFORM public.internal_log_audit(NULL, p_identifier, 'LOGIN_FAILED', 'AUTH', NULL, 'FAILURE', jsonb_build_object('reason', 'user_not_found'));
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDENTIALS', 'message', 'Invalid username/email or password.');
  END IF;

  SELECT * INTO v_lss
  FROM public.login_security_state
  WHERE user_id = v_profile.id
  FOR UPDATE;

  -- Check admin lock or account deactivation
  IF v_profile.is_admin_locked OR NOT v_profile.is_active THEN
    PERFORM public.internal_log_audit(v_profile.id, v_profile.email, 'LOGIN_FAILED', 'AUTH', NULL, 'LOCKED', jsonb_build_object('is_admin_locked', v_profile.is_admin_locked, 'is_active', v_profile.is_active));
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_ADMIN_LOCKED_OR_INACTIVE', 'message', 'This account has been locked or deactivated by an administrator.');
  END IF;

  -- Check live temporary lockout timer
  IF v_lss.locked_until IS NOT NULL AND v_lss.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'TEMP_LOCKED',
      'locked_until', v_lss.locked_until,
      'lockout_tier', v_lss.lockout_tier,
      'captcha_required', v_lss.captcha_required,
      'message', format('Account is temporarily locked. Try again in %s seconds.', EXTRACT(EPOCH FROM (v_lss.locked_until - now()))::integer)
    );
  END IF;

  -- If post-lockout CAPTCHA is required, verify and immediately clear hash to prevent replay
  IF v_lss.captcha_required THEN
    IF v_lss.active_captcha_hash IS NULL OR p_captcha_input IS NULL OR
       v_lss.active_captcha_hash != crypt(upper(trim(p_captcha_input)), v_lss.active_captcha_hash) THEN
      
      -- Clear active hash on failed CAPTCHA
      UPDATE public.login_security_state
      SET active_captcha_hash = NULL, updated_at = now()
      WHERE user_id = v_profile.id;

      PERFORM public.internal_log_audit(v_profile.id, v_profile.email, 'CAPTCHA_FAILED', 'AUTH', NULL, 'FAILURE', '{}'::jsonb);
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'CAPTCHA_INVALID',
        'captcha_required', true,
        'message', 'Incorrect visual CAPTCHA code. Please enter the fresh code shown.'
      );
    ELSE
      v_active_captcha_matched := true;
      -- Clear hash immediately so it cannot be reused
      UPDATE public.login_security_state
      SET active_captcha_hash = NULL, updated_at = now()
      WHERE user_id = v_profile.id;
    END IF;
  END IF;

  -- Check password against canonical auth.users
  SELECT encrypted_password INTO v_enc_pass
  FROM auth.users
  WHERE id = v_profile.id;

  IF v_enc_pass IS NULL OR v_enc_pass != crypt(p_password, v_enc_pass) THEN
    -- Increment failed attempt
    v_lss.failed_attempts := v_lss.failed_attempts + 1;

    IF v_lss.failed_attempts >= 3 THEN
      v_lss.lockout_tier := v_lss.lockout_tier + 1;
      v_lss.failed_attempts := 0;
      v_lss.captcha_required := true;
      
      IF v_lss.lockout_tier = 1 THEN
        v_lock_interval := interval '1 minute';
      ELSIF v_lss.lockout_tier = 2 THEN
        v_lock_interval := interval '5 minutes';
      ELSE
        v_lock_interval := interval '15 minutes';
      END IF;

      v_lss.locked_until := now() + v_lock_interval;

      UPDATE public.login_security_state
      SET failed_attempts = 0,
          lockout_tier = v_lss.lockout_tier,
          locked_until = v_lss.locked_until,
          captcha_required = true,
          active_captcha_hash = NULL,
          updated_at = now()
      WHERE user_id = v_profile.id;

      PERFORM public.internal_log_audit(
        v_profile.id,
        v_profile.email,
        'ACCOUNT_LOCKED_TEMP',
        'AUTH',
        NULL,
        'LOCKED',
        jsonb_build_object('tier', v_lss.lockout_tier, 'locked_until', v_lss.locked_until)
      );

      RETURN jsonb_build_object(
        'ok', false,
        'code', 'TEMP_LOCKED',
        'locked_until', v_lss.locked_until,
        'lockout_tier', v_lss.lockout_tier,
        'captcha_required', true,
        'message', format('3 consecutive failed attempts. Account temporarily locked for %s.', CASE v_lss.lockout_tier WHEN 1 THEN '1 minute' WHEN 2 THEN '5 minutes' ELSE '15 minutes' END)
      );
    ELSE
      UPDATE public.login_security_state
      SET failed_attempts = v_lss.failed_attempts,
          updated_at = now()
      WHERE user_id = v_profile.id;

      PERFORM public.internal_log_audit(
        v_profile.id,
        v_profile.email,
        'LOGIN_FAILED',
        'AUTH',
        NULL,
        'FAILURE',
        jsonb_build_object('failed_attempts', v_lss.failed_attempts)
      );

      RETURN jsonb_build_object(
        'ok', false,
        'code', 'INVALID_CREDENTIALS',
        'remaining_attempts', 3 - v_lss.failed_attempts,
        'captcha_required', v_lss.captcha_required,
        'message', format('Invalid username/email or password. %s attempt(s) remaining.', 3 - v_lss.failed_attempts)
      );
    END IF;
  END IF;

  -- Valid Credentials: Reset lockout state
  UPDATE public.login_security_state
  SET failed_attempts = 0,
      lockout_tier = 0,
      locked_until = NULL,
      captcha_required = false,
      active_captcha_hash = NULL,
      updated_at = now()
  WHERE user_id = v_profile.id;

  PERFORM public.internal_log_audit(v_profile.id, v_profile.email, 'LOGIN_SUCCESS', 'AUTH', NULL, 'SUCCESS', '{}'::jsonb);

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_profile.id,
    'email', v_profile.email,
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'email_verified', v_profile.email_verified,
    'onboarding_completed', v_profile.onboarding_completed,
    'onboarding_step', v_profile.onboarding_step,
    'active_mode', v_profile.active_mode,
    'message', 'Login validated successfully.'
  );
END;
$$;

-- 6.8 rpc_reset_password_with_otp
CREATE OR REPLACE FUNCTION public.rpc_reset_password_with_otp(
  p_challenge_id uuid,
  p_otp_code text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_ch public.otp_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_ch
  FROM public.otp_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF v_ch.id IS NULL OR v_ch.purpose != 'password_reset' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CHALLENGE', 'message', 'Invalid password reset challenge.');
  END IF;

  -- Accept either status = 'verified' (from Stage 2) or verify code directly
  IF v_ch.status != 'verified' THEN
    IF v_ch.status != 'active' OR v_ch.otp_hash != crypt(trim(p_otp_code), v_ch.otp_hash) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'OTP_INVALID', 'message', 'Invalid or unverified recovery code.');
    END IF;
  END IF;

  -- Enforce 5 password complexity rules
  IF length(p_new_password) < 8 OR
     p_new_password !~ '[A-Z]' OR
     p_new_password !~ '[a-z]' OR
     p_new_password !~ '[0-9]' OR
     p_new_password !~ '[^a-zA-Z0-9]' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PASSWORD_COMPLEXITY_FAILED',
      'message', 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
    );
  END IF;

  -- Consume challenge
  UPDATE public.otp_challenges
  SET status = 'used', consumed_at = now()
  WHERE id = v_ch.id;

  -- Update canonical password
  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf', 10)), updated_at = now()
  WHERE id = v_ch.user_id;

  -- Revoke ALL active sessions for this user (IAS 1 Checklist E)
  UPDATE public.user_sessions
  SET is_revoked = true, revoked_reason = 'password_reset'
  WHERE user_id = v_ch.user_id;

  -- Reset lockout state
  UPDATE public.login_security_state
  SET failed_attempts = 0, lockout_tier = 0, locked_until = NULL, captcha_required = false, active_captcha_hash = NULL
  WHERE user_id = v_ch.user_id;

  PERFORM public.internal_log_audit(
    v_ch.user_id,
    v_ch.target_email,
    'PASSWORD_RESET_COMPLETED',
    'AUTH',
    NULL,
    'SUCCESS',
    '{}'::jsonb
  );

  PERFORM public.internal_log_audit(
    v_ch.user_id,
    v_ch.target_email,
    'SESSIONS_REVOKED_ON_PASSWORD_RESET',
    'AUTH',
    NULL,
    'SUCCESS',
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Password reset successfully. All active sessions have been revoked. Please log in.'
  );
END;
$$;

-- 6.9 rpc_change_password (Authenticated password change with session revocation)
CREATE OR REPLACE FUNCTION public.rpc_change_password(
  p_current_password text,
  p_new_password text,
  p_current_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_enc_pass text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT encrypted_password INTO v_enc_pass
  FROM auth.users
  WHERE id = v_uid;

  IF v_enc_pass IS NULL OR v_enc_pass != crypt(p_current_password, v_enc_pass) THEN
    PERFORM public.internal_log_audit(v_uid, NULL, 'PASSWORD_CHANGE_FAILED', 'SETTINGS', NULL, 'FAILURE', jsonb_build_object('reason', 'incorrect_current_password'));
    RETURN jsonb_build_object('ok', false, 'code', 'INCORRECT_CURRENT_PASSWORD', 'message', 'Current password is incorrect.');
  END IF;

  IF p_new_password = p_current_password THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PASSWORD_REUSED', 'message', 'New password must be different from current password.');
  END IF;

  IF length(p_new_password) < 8 OR
     p_new_password !~ '[A-Z]' OR
     p_new_password !~ '[a-z]' OR
     p_new_password !~ '[0-9]' OR
     p_new_password !~ '[^a-zA-Z0-9]' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PASSWORD_COMPLEXITY_FAILED',
      'message', 'New password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
    );
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf', 10)), updated_at = now()
  WHERE id = v_uid;

  -- Revoke all OTHER sessions (IAS 1 Checklist C)
  UPDATE public.user_sessions
  SET is_revoked = true, revoked_reason = 'password_changed'
  WHERE user_id = v_uid AND (p_current_session_id IS NULL OR id != p_current_session_id);

  PERFORM public.internal_log_audit(v_uid, NULL, 'PASSWORD_CHANGED', 'SETTINGS', NULL, 'SUCCESS', '{}'::jsonb);

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Password changed successfully. All other active sessions have been revoked.'
  );
END;
$$;

-- 6.10 rpc_request_email_change & rpc_confirm_email_change
CREATE OR REPLACE FUNCTION public.rpc_request_email_change(
  p_current_password text,
  p_new_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_enc_pass text;
  v_new_em text := lower(trim(p_new_email));
  v_otp_code text;
  v_challenge_id uuid;
  v_expires_at timestamptz := now() + interval '5 minutes';
  v_resend_at timestamptz := now() + interval '60 seconds';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT encrypted_password INTO v_enc_pass FROM auth.users WHERE id = v_uid;
  IF v_enc_pass IS NULL OR v_enc_pass != crypt(p_current_password, v_enc_pass) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INCORRECT_PASSWORD', 'message', 'Incorrect current password.');
  END IF;

  IF v_new_em !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EMAIL_FORMAT', 'message', 'Please enter a valid email address.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = v_new_em AND id != v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EMAIL_TAKEN', 'message', 'This email address is already in use.');
  END IF;

  v_otp_code := (floor(random() * 900000 + 100000)::integer)::text;

  INSERT INTO public.otp_challenges (
    user_id, target_email, purpose, otp_hash, expires_at, resend_available_at, status
  ) VALUES (
    v_uid, v_new_em, 'email_change', crypt(v_otp_code, gen_salt('bf', 8)), v_expires_at, v_resend_at, 'active'
  ) RETURNING id INTO v_challenge_id;

  INSERT INTO public.project_inbox_messages (
    user_id, otp_challenge_id, recipient_email, purpose, subject, otp_code_display, expires_at
  ) VALUES (
    v_uid, v_challenge_id, v_new_em, 'email_change', 'Confirm Email Address Change', v_otp_code, v_expires_at
  );

  RETURN jsonb_build_object(
    'ok', true,
    'challenge_id', v_challenge_id,
    'new_email', v_new_em,
    'expires_at', v_expires_at,
    'message', 'Verification code dispatched to Project Mail Inbox.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_confirm_email_change(
  p_challenge_id uuid,
  p_otp_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_ch public.otp_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_ch FROM public.otp_challenges WHERE id = p_challenge_id FOR UPDATE;

  IF v_ch.id IS NULL OR v_ch.purpose != 'email_change' OR v_ch.status != 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CHALLENGE', 'message', 'Invalid or consumed verification challenge.');
  END IF;

  IF v_ch.otp_hash != crypt(trim(p_otp_code), v_ch.otp_hash) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OTP_MISMATCH', 'message', 'Incorrect verification code.');
  END IF;

  -- Atomically update both auth.users and public.profiles
  UPDATE auth.users SET email = v_ch.target_email, updated_at = now() WHERE id = v_ch.user_id;
  UPDATE public.profiles SET email = v_ch.target_email, email_verified = true, updated_at = now() WHERE id = v_ch.user_id;
  UPDATE public.otp_challenges SET status = 'used', consumed_at = now() WHERE id = v_ch.id;

  PERFORM public.internal_log_audit(v_ch.user_id, v_ch.target_email, 'EMAIL_CHANGED', 'SETTINGS', NULL, 'SUCCESS', '{}'::jsonb);

  RETURN jsonb_build_object('ok', true, 'new_email', v_ch.target_email, 'message', 'Email address updated successfully.');
END;
$$;

-- 6.11 rpc_register_session, rpc_validate_session, rpc_revoke_session, rpc_log_inactivity_logout
CREATE OR REPLACE FUNCTION public.rpc_register_session(
  p_session_token_fingerprint text,
  p_device_info text,
  p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  INSERT INTO public.user_sessions (
    user_id,
    session_token_fingerprint,
    device_info,
    ip_address,
    is_revoked,
    last_active_at,
    expires_at
  ) VALUES (
    v_uid,
    p_session_token_fingerprint,
    p_device_info,
    p_ip_address,
    false,
    now(),
    now() + interval '30 days'
  ) RETURNING id INTO v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_validate_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_sess public.user_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_sess FROM public.user_sessions WHERE id = p_session_id;

  IF v_sess.id IS NULL OR v_sess.is_revoked OR v_sess.last_active_at < (now() - interval '15 minutes') THEN
    RETURN jsonb_build_object('ok', true, 'is_valid', false);
  END IF;

  UPDATE public.user_sessions SET last_active_at = now() WHERE id = p_session_id;
  RETURN jsonb_build_object('ok', true, 'is_valid', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_revoke_session(
  p_session_id uuid,
  p_revoke_all_others boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  IF p_revoke_all_others THEN
    UPDATE public.user_sessions
    SET is_revoked = true, revoked_reason = 'user_revoked_others'
    WHERE user_id = v_uid AND id != p_session_id;
  ELSE
    UPDATE public.user_sessions
    SET is_revoked = true, revoked_reason = 'user_revoked_session'
    WHERE id = p_session_id AND user_id = v_uid;
  END IF;

  PERFORM public.internal_log_audit(v_uid, NULL, 'SESSION_REVOKED', 'SETTINGS', NULL, 'SUCCESS', jsonb_build_object('all_others', p_revoke_all_others));
  RETURN jsonb_build_object('ok', true, 'message', 'Session(s) revoked.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_log_inactivity_logout(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_session_id IS NOT NULL THEN
    UPDATE public.user_sessions
    SET is_revoked = true, revoked_reason = 'inactivity_timeout'
    WHERE id = p_session_id;
  END IF;

  PERFORM public.internal_log_audit(
    v_uid,
    NULL,
    'AUTO_LOGOUT_INACTIVITY',
    'AUTH',
    NULL,
    'SUCCESS',
    jsonb_build_object('session_id', p_session_id, 'idle_duration', '15m')
  );

  RETURN jsonb_build_object('ok', true, 'message', 'Inactivity logout recorded.');
END;
$$;
