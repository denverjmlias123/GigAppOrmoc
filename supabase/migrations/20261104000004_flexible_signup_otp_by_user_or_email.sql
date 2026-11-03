-- Migration: 20261104000004_flexible_signup_otp_by_user_or_email.sql
-- Allow create_signup_otp and verify_signup_otp to look up users by user_id or email

DROP FUNCTION IF EXISTS public.create_signup_otp(uuid);
DROP FUNCTION IF EXISTS public.create_signup_otp(uuid, text);

CREATE OR REPLACE FUNCTION public.create_signup_otp(
  p_user_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $function$
DECLARE
  v_uid uuid := p_user_id;
  v_otp text;
  v_otp_hash text;
BEGIN
  IF v_uid IS NULL AND p_email IS NOT NULL AND trim(p_email) <> '' THEN
    SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  END IF;

  IF v_uid IS NULL THEN
    v_uid := auth.uid();
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'User not found.';
  END IF;

  -- Generate 6-digit numeric OTP
  v_otp := lpad(floor(random() * 1000000)::int::text, 6, '0');

  -- Hash OTP bound to user id
  v_otp_hash := encode(digest(concat(v_otp, v_uid::text), 'sha256'), 'hex');

  -- Invalidate any existing unused OTPs for this user
  UPDATE public.email_verification_otps
  SET used_at = now()
  WHERE user_id = v_uid AND used_at IS NULL AND purpose = 'signup';

  -- Insert new OTP
  INSERT INTO public.email_verification_otps (user_id, purpose, otp_hash, expires_at)
  VALUES (v_uid, 'signup', v_otp_hash, now() + interval '10 minutes');

  RETURN v_otp;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_signup_otp(uuid, text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.verify_signup_otp(uuid, text);
DROP FUNCTION IF EXISTS public.verify_signup_otp(uuid, text, text);

CREATE OR REPLACE FUNCTION public.verify_signup_otp(
  p_user_id uuid DEFAULT NULL,
  p_otp text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $function$
DECLARE
  v_uid uuid := p_user_id;
  v_otp_hash text;
BEGIN
  IF v_uid IS NULL AND p_email IS NOT NULL AND trim(p_email) <> '' THEN
    SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  END IF;

  IF v_uid IS NULL THEN
    v_uid := auth.uid();
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Find latest unused, unexpired signup OTP for this user
  SELECT otp_hash INTO v_otp_hash
  FROM public.email_verification_otps
  WHERE user_id = v_uid
    AND purpose = 'signup'
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_otp_hash IS NULL THEN
    RETURN false;
  END IF;

  -- Verify hash
  IF encode(digest(concat(trim(p_otp), v_uid::text), 'sha256'), 'hex') <> v_otp_hash THEN
    RETURN false;
  END IF;

  -- Mark as used
  UPDATE public.email_verification_otps
  SET used_at = now()
  WHERE user_id = v_uid
    AND purpose = 'signup'
    AND used_at IS NULL
    AND expires_at > now()
    AND otp_hash = v_otp_hash;

  -- Confirm email in auth.users so Supabase allows sign-in
  UPDATE auth.users
  SET email_confirmed_at = coalesce(email_confirmed_at, now())
  WHERE id = v_uid;

  -- Update profiles email_verified
  UPDATE public.profiles
  SET email_verified = true, updated_at = now()
  WHERE id = v_uid;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.verify_signup_otp(uuid, text, text) TO anon, authenticated, service_role;
