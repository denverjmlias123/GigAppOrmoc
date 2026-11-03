-- ============================================================================
-- Migration: In-app OTP for signup and forgot password, plus strict single Super Admin constraint
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. In-app OTP table for fake email / zero-SMTP authentication
CREATE TABLE IF NOT EXISTS public.email_verification_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'signup',
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_otps_user_id ON public.email_verification_otps(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_otps_expires_at ON public.email_verification_otps(expires_at);

ALTER TABLE public.email_verification_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can view own OTPs" ON public.email_verification_otps;
CREATE POLICY "Owner can view own OTPs" ON public.email_verification_otps
  FOR SELECT USING (auth.uid() = user_id);

-- 2. create_signup_otp RPC
CREATE OR REPLACE FUNCTION public.create_signup_otp(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_otp text;
  v_otp_hash text;
BEGIN
  -- Generate 6-digit numeric OTP
  v_otp := lpad(floor(random() * 1000000)::int::text, 6, '0');

  -- Hash OTP bound to user id
  v_otp_hash := encode(digest(concat(v_otp, p_user_id::text), 'sha256'), 'hex');

  -- Invalidate any existing unused OTPs for this user
  UPDATE public.email_verification_otps
  SET used_at = now()
  WHERE user_id = p_user_id AND used_at IS NULL AND purpose = 'signup';

  -- Insert new OTP
  INSERT INTO public.email_verification_otps (user_id, purpose, otp_hash, expires_at)
  VALUES (p_user_id, 'signup', v_otp_hash, now() + interval '10 minutes');

  RETURN v_otp;
END;
$$;

-- 3. verify_signup_otp RPC
CREATE OR REPLACE FUNCTION public.verify_signup_otp(p_user_id uuid, p_otp text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_otp_hash text;
BEGIN
  -- Find latest unused, unexpired signup OTP for this user
  SELECT otp_hash INTO v_otp_hash
  FROM public.email_verification_otps
  WHERE user_id = p_user_id
    AND purpose = 'signup'
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_otp_hash IS NULL THEN
    RETURN false;
  END IF;

  -- Verify hash
  IF encode(digest(concat(trim(p_otp), p_user_id::text), 'sha256'), 'hex') <> v_otp_hash THEN
    RETURN false;
  END IF;

  -- Mark as used
  UPDATE public.email_verification_otps
  SET used_at = now()
  WHERE user_id = p_user_id
    AND purpose = 'signup'
    AND used_at IS NULL
    AND expires_at > now()
    AND otp_hash = v_otp_hash;

  -- Confirm email in auth.users so Supabase allows sign-in
  UPDATE auth.users
  SET email_confirmed_at = coalesce(email_confirmed_at, now())
  WHERE id = p_user_id;

  -- Update profiles email_verified
  UPDATE public.profiles
  SET email_verified = true, updated_at = now()
  WHERE id = p_user_id;

  RETURN true;
END;
$$;

-- 4. create_password_reset_otp RPC
CREATE OR REPLACE FUNCTION public.create_password_reset_otp(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_otp text;
  v_otp_hash text;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email));

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND', 'message', 'No account found with this email.');
  END IF;

  -- Generate 6-digit numeric OTP
  v_otp := lpad(floor(random() * 1000000)::int::text, 6, '0');
  v_otp_hash := encode(digest(concat(v_otp, v_user_id::text), 'sha256'), 'hex');

  -- Invalidate prior unused reset OTPs for this user
  UPDATE public.email_verification_otps
  SET used_at = now()
  WHERE user_id = v_user_id AND purpose = 'password_reset' AND used_at IS NULL;

  INSERT INTO public.email_verification_otps (user_id, purpose, otp_hash, expires_at)
  VALUES (v_user_id, 'password_reset', v_otp_hash, now() + interval '10 minutes');

  RETURN jsonb_build_object('ok', true, 'otp', v_otp);
END;
$$;

-- 5. verify_password_reset_otp RPC
CREATE OR REPLACE FUNCTION public.verify_password_reset_otp(p_email text, p_otp text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_otp_hash text;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email));

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND', 'message', 'User not found.');
  END IF;

  SELECT otp_hash INTO v_otp_hash
  FROM public.email_verification_otps
  WHERE user_id = v_user_id
    AND purpose = 'password_reset'
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_otp_hash IS NULL OR encode(digest(concat(trim(p_otp), v_user_id::text), 'sha256'), 'hex') <> v_otp_hash THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_OTP', 'message', 'Invalid or expired verification code.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 6. verify_and_reset_password RPC
CREATE OR REPLACE FUNCTION public.verify_and_reset_password(
  p_email text,
  p_otp text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_otp_hash text;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email));

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND', 'message', 'User not found.');
  END IF;

  SELECT otp_hash INTO v_otp_hash
  FROM public.email_verification_otps
  WHERE user_id = v_user_id
    AND purpose = 'password_reset'
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_otp_hash IS NULL OR encode(digest(concat(trim(p_otp), v_user_id::text), 'sha256'), 'hex') <> v_otp_hash THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_OTP', 'message', 'Invalid or expired verification code.');
  END IF;

  -- Validate password complexity
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

  -- Mark OTP used
  UPDATE public.email_verification_otps
  SET used_at = now()
  WHERE user_id = v_user_id
    AND purpose = 'password_reset'
    AND used_at IS NULL
    AND expires_at > now()
    AND otp_hash = v_otp_hash;

  -- Update user password
  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf', 10)),
      updated_at = now()
  WHERE id = v_user_id;

  -- Revoke existing sessions
  UPDATE public.user_sessions
  SET is_revoked = true, revoked_reason = 'password_reset'
  WHERE user_id = v_user_id;

  -- Reset lockout state
  UPDATE public.login_security_state
  SET failed_attempts = 0, lockout_tier = 0, locked_until = NULL, captcha_required = false, active_captcha_hash = NULL
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Permissions for OTP functions
GRANT EXECUTE ON FUNCTION public.create_signup_otp(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_signup_otp(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_password_reset_otp(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_password_reset_otp(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_and_reset_password(text, text, text) TO anon, authenticated, service_role;

-- 7. Super Admin Constraints & Provisions
-- Strictly only ONE Super Admin account can exist, and NO regular admin accounts
ALTER TABLE public.platform_admins DROP CONSTRAINT IF EXISTS platform_admins_role_check;
ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_role_check CHECK (role = 'super_admin');

CREATE OR REPLACE FUNCTION public.trg_enforce_single_super_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT count(*) FROM public.platform_admins WHERE user_id != NEW.user_id) >= 1 THEN
    RAISE EXCEPTION 'Only strictly one Super Admin account can exist in the system.';
  END IF;
  IF NEW.role != 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin role is permitted in platform_admins.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_single_super_admin ON public.platform_admins;
CREATE TRIGGER trg_single_super_admin
BEFORE INSERT OR UPDATE ON public.platform_admins
FOR EACH ROW
EXECUTE FUNCTION public.trg_enforce_single_super_admin();

-- Restrict platform_admins writes to backend only
REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM public, anon, authenticated;
GRANT SELECT ON public.platform_admins TO authenticated;

-- Disallow rpc_admin_create_user from ever creating super_admin or admin
CREATE OR REPLACE FUNCTION public.rpc_admin_create_user(
  p_username text,
  p_display_name text,
  p_email text,
  p_password text,
  p_dob date,
  p_initial_role text DEFAULT 'client'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_new_id uuid := gen_random_uuid();
  v_uname text := lower(trim(p_username));
  v_em text := lower(trim(p_email));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_admin_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Admin privileges required.');
  END IF;

  IF p_initial_role IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'FORBIDDEN',
      'message', 'Super Admin accounts cannot be created from the application. Only one Super Admin exists and is provisioned in the backend.'
    );
  END IF;

  -- Create auth user
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated', v_em,
    crypt(p_password, gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_uname, 'display_name', p_display_name),
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (v_new_id, v_new_id, jsonb_build_object('sub', v_new_id::text, 'email', v_em), 'email', v_new_id::text, now(), now(), now());

  INSERT INTO public.profiles (id, username, email, display_name, date_of_birth, active_mode, email_verified, onboarding_completed, onboarding_step)
  VALUES (v_new_id, v_uname, v_em, trim(p_display_name), p_dob, p_initial_role, true, true, 3);

  INSERT INTO public.login_security_state (user_id, failed_attempts, lockout_tier, captcha_required)
  VALUES (v_new_id, 0, 0, false);

  PERFORM public.internal_log_audit(v_admin_id, NULL, 'ADMIN_USER_CREATED', 'ADMIN', NULL, 'SUCCESS', jsonb_build_object('created_user_id', v_new_id, 'role', p_initial_role));

  RETURN jsonb_build_object('ok', true, 'user_id', v_new_id);
END;
$$;

-- 8. Seed the strictly single Super Admin backend account
DO $$
DECLARE
  v_admin_id uuid := '00000000-0000-0000-0000-000000000001';
  v_admin_email text := 'superadmin@gigormoc.local';
  v_admin_pass text := 'SuperAdmin@123!';
BEGIN
  -- Insert into auth.users if not present
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_admin_email) THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_admin_id, 'authenticated', 'authenticated',
      v_admin_email, crypt(v_admin_pass, gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', 'superadmin', 'display_name', 'Super Admin'),
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (v_admin_id, v_admin_id, jsonb_build_object('sub', v_admin_id::text, 'email', v_admin_email), 'email', v_admin_id::text, now(), now(), now());
  ELSE
    SELECT id INTO v_admin_id FROM auth.users WHERE email = v_admin_email;
  END IF;

  -- Insert profile
  INSERT INTO public.profiles (
    id, username, email, display_name, date_of_birth, active_mode, email_verified,
    onboarding_completed, onboarding_step
  ) VALUES (
    v_admin_id, 'superadmin', v_admin_email, 'Super Admin', '1990-01-01', 'client',
    true, true, 3
  ) ON CONFLICT (id) DO UPDATE SET
    email_verified = true, onboarding_completed = true;

  -- Insert login security state
  INSERT INTO public.login_security_state (user_id, failed_attempts, lockout_tier, captcha_required)
  VALUES (v_admin_id, 0, 0, false)
  ON CONFLICT (user_id) DO NOTHING;

  -- Insert single super admin into platform_admins
  INSERT INTO public.platform_admins (user_id, role, assigned_by)
  VALUES (v_admin_id, 'super_admin', v_admin_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;
