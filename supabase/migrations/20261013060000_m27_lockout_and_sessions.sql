-- M27: server-side login lockout state and user session tracking.
-- Credentials, email snapshots, and session state are never directly readable by clients.

CREATE TABLE public.login_attempts (
  email_normalized text PRIMARY KEY CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) BETWEEN 3 AND 320),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count BETWEEN 0 AND 2),
  lock_level integer NOT NULL DEFAULT 0 CHECK (lock_level BETWEEN 0 AND 5),
  locked_until timestamptz,
  last_failed_at timestamptz,
  last_ip text CHECK (last_ip IS NULL OR length(last_ip) <= 64),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_attempts FROM PUBLIC, anon, authenticated;

CREATE TABLE public.login_ip_attempts (
  ip_normalized text PRIMARY KEY CHECK (length(ip_normalized) BETWEEN 2 AND 64),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count BETWEEN 0 AND 9),
  lock_level integer NOT NULL DEFAULT 0 CHECK (lock_level BETWEEN 0 AND 5),
  locked_until timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.login_ip_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_ip_attempts FROM PUBLIC, anon, authenticated;

CREATE TABLE public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('logout', 'expired', 'revoked', 'locked', 'password_changed')),
  device_label text NOT NULL DEFAULT 'This device' CHECK (length(device_label) BETWEEN 1 AND 80),
  platform text NOT NULL DEFAULT 'unknown' CHECK (platform IN ('ios', 'android', 'web', 'unknown')),
  CONSTRAINT user_sessions_end_state CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT user_sessions_request_unique UNIQUE (user_id, request_id)
);

CREATE INDEX user_sessions_user_active_idx ON public.user_sessions(user_id, last_seen_at DESC) WHERE ended_at IS NULL;
CREATE INDEX user_sessions_user_started_idx ON public.user_sessions(user_id, started_at DESC);
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_sessions FROM PUBLIC, anon, authenticated;

-- This RPC is callable only by the service role from the login-guard Edge Function.
CREATE OR REPLACE FUNCTION public.login_guard_check(p_email text, p_ip text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.login_attempts%ROWTYPE;
  v_ip_row public.login_ip_attempts%ROWTYPE;
  v_seconds integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF length(v_email) NOT BETWEEN 3 AND 320 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;
  IF p_ip IS NOT NULL AND p_ip ~ '^[0-9a-fA-F:.]{2,64}$' THEN
    SELECT * INTO v_ip_row FROM public.login_ip_attempts WHERE ip_normalized = p_ip FOR UPDATE;
    IF FOUND AND v_ip_row.locked_until > now() THEN
      RETURN jsonb_build_object('locked', true,
        'seconds_left', ceil(extract(epoch FROM (v_ip_row.locked_until - now())))::integer,
        'attempts_left', 0);
    END IF;
  END IF;
  SELECT * INTO v_row FROM public.login_attempts WHERE email_normalized = v_email FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('locked', false, 'seconds_left', 0, 'attempts_left', 3);
  END IF;
  IF v_row.last_failed_at IS NOT NULL AND v_row.last_failed_at <= now() - interval '24 hours' THEN
    UPDATE public.login_attempts SET failed_count = 0, lock_level = 0, locked_until = NULL,
      last_failed_at = NULL, last_ip = NULL, updated_at = now() WHERE email_normalized = v_email;
    RETURN jsonb_build_object('locked', false, 'seconds_left', 0, 'attempts_left', 3);
  END IF;
  IF v_row.locked_until > now() THEN
    v_seconds := ceil(extract(epoch FROM (v_row.locked_until - now())))::integer;
    RETURN jsonb_build_object('locked', true, 'seconds_left', v_seconds, 'attempts_left', 0);
  END IF;
  IF v_row.locked_until IS NOT NULL THEN
    UPDATE public.login_attempts SET locked_until = NULL, failed_count = 0, updated_at = now()
      WHERE email_normalized = v_email;
    RETURN jsonb_build_object('locked', false, 'seconds_left', 0, 'attempts_left', 3);
  END IF;
  RETURN jsonb_build_object('locked', false, 'seconds_left', 0, 'attempts_left', 3 - v_row.failed_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.login_guard_failure(p_email text, p_ip text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.login_attempts%ROWTYPE;
  v_ip_row public.login_ip_attempts%ROWTYPE;
  v_level integer;
  v_wait_seconds integer;
  v_failed integer;
  v_attempts integer;
  v_ip_failed integer;
  v_ip_level integer;
  v_ip_wait_seconds integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF length(v_email) NOT BETWEEN 3 AND 320 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  IF p_ip IS NOT NULL AND p_ip ~ '^[0-9a-fA-F:.]{2,64}$' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ip:' || p_ip, 0));
    SELECT * INTO v_ip_row FROM public.login_ip_attempts WHERE ip_normalized = p_ip FOR UPDATE;
    IF FOUND AND v_ip_row.locked_until > now() THEN
      RETURN jsonb_build_object('locked', true,
        'seconds_left', ceil(extract(epoch FROM (v_ip_row.locked_until - now())))::integer,
        'attempts_left', 0);
    END IF;
    IF NOT FOUND OR (v_ip_row.last_failed_at IS NOT NULL AND v_ip_row.last_failed_at <= now() - interval '24 hours') THEN
      v_ip_failed := 0;
      v_ip_level := 0;
    ELSIF v_ip_row.locked_until IS NOT NULL THEN
      v_ip_failed := 0;
      v_ip_level := v_ip_row.lock_level;
    ELSE
      v_ip_failed := v_ip_row.failed_count;
      v_ip_level := v_ip_row.lock_level;
    END IF;
    v_ip_failed := v_ip_failed + 1;
    v_ip_wait_seconds := 0;
    IF v_ip_failed >= 10 THEN
      v_ip_level := least(v_ip_level + 1, 5);
      v_ip_wait_seconds := CASE v_ip_level WHEN 1 THEN 60 WHEN 2 THEN 300 WHEN 3 THEN 900 WHEN 4 THEN 1800 ELSE 3600 END;
      v_ip_failed := 0;
    END IF;
    INSERT INTO public.login_ip_attempts(ip_normalized, failed_count, lock_level, locked_until, last_failed_at, updated_at)
    VALUES (p_ip, v_ip_failed, v_ip_level,
      CASE WHEN v_ip_wait_seconds > 0 THEN now() + make_interval(secs => v_ip_wait_seconds) ELSE NULL END, now(), now())
    ON CONFLICT (ip_normalized) DO UPDATE SET failed_count = EXCLUDED.failed_count,
      lock_level = EXCLUDED.lock_level, locked_until = EXCLUDED.locked_until,
      last_failed_at = EXCLUDED.last_failed_at, updated_at = now();
    IF v_ip_wait_seconds > 0 THEN
      RETURN jsonb_build_object('locked', true, 'seconds_left', v_ip_wait_seconds, 'attempts_left', 0);
    END IF;
  END IF;

  -- Serialize simultaneous failures for the same normalized address before updating the counter.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_email, 0));
  SELECT * INTO v_row FROM public.login_attempts WHERE email_normalized = v_email FOR UPDATE;
  IF FOUND AND v_row.locked_until > now() THEN
    RETURN jsonb_build_object('locked', true,
      'seconds_left', ceil(extract(epoch FROM (v_row.locked_until - now())))::integer,
      'attempts_left', 0);
  END IF;

  IF NOT FOUND THEN
    v_row.failed_count := 0;
    v_row.lock_level := 0;
    v_row.last_failed_at := NULL;
    v_row.locked_until := NULL;
  ELSIF v_row.last_failed_at IS NOT NULL AND v_row.last_failed_at <= now() - interval '24 hours' THEN
    v_row.failed_count := 0;
    v_row.lock_level := 0;
  ELSIF v_row.locked_until IS NOT NULL THEN
    -- The previous lock expired; begin the next round at three fresh attempts.
    v_row.failed_count := 0;
    v_row.locked_until := NULL;
  END IF;

  v_failed := v_row.failed_count + 1;
  v_level := v_row.lock_level;
  v_wait_seconds := 0;
  IF v_failed >= 3 THEN
    v_level := least(v_level + 1, 5);
    v_wait_seconds := CASE v_level WHEN 1 THEN 60 WHEN 2 THEN 300 WHEN 3 THEN 900 WHEN 4 THEN 1800 ELSE 3600 END;
    v_failed := 0;
  END IF;
  v_attempts := CASE WHEN v_wait_seconds > 0 THEN 0 ELSE 3 - v_failed END;

  INSERT INTO public.login_attempts(email_normalized, failed_count, lock_level, locked_until, last_failed_at, last_ip, updated_at)
  VALUES (v_email, v_failed, v_level,
    CASE WHEN v_wait_seconds > 0 THEN now() + make_interval(secs => v_wait_seconds) ELSE NULL END,
    now(), nullif(left(coalesce(p_ip, ''), 64), ''), now())
  ON CONFLICT (email_normalized) DO UPDATE SET failed_count = EXCLUDED.failed_count,
    lock_level = EXCLUDED.lock_level, locked_until = EXCLUDED.locked_until,
    last_failed_at = EXCLUDED.last_failed_at, last_ip = EXCLUDED.last_ip, updated_at = now();

  INSERT INTO public.audit_events(actor_id, action, entity_type, metadata)
  VALUES (NULL, CASE WHEN v_wait_seconds > 0 THEN 'login_locked' ELSE 'login_failed' END,
    'auth', jsonb_build_object('attempts_left', v_attempts, 'lock_level', v_level));
  RETURN jsonb_build_object('locked', v_wait_seconds > 0, 'seconds_left', v_wait_seconds, 'attempts_left', v_attempts);
END;
$$;

CREATE OR REPLACE FUNCTION public.login_guard_success(p_email text, p_user_id uuid, p_ip text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_email text := lower(btrim(coalesce(p_email, ''))); v_auth_user uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF length(v_email) NOT BETWEEN 3 AND 320 THEN RAISE EXCEPTION 'invalid_email'; END IF;
  SELECT id INTO v_auth_user FROM auth.users WHERE id = p_user_id AND lower(email) = v_email;
  IF v_auth_user IS NULL THEN RAISE EXCEPTION 'authenticated_user_email_mismatch'; END IF;
  DELETE FROM public.login_attempts WHERE email_normalized = v_email;
  IF p_ip IS NOT NULL AND p_ip ~ '^[0-9a-fA-F:.]{2,64}$' THEN
    DELETE FROM public.login_ip_attempts WHERE ip_normalized = p_ip;
  END IF;
  INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id)
    VALUES (v_auth_user, 'login_succeeded', 'auth', v_auth_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_session(p_device_label text DEFAULT 'This device', p_platform text DEFAULT 'unknown', p_request_id uuid DEFAULT gen_random_uuid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_user uuid := auth.uid(); v_session public.user_sessions%ROWTYPE; v_already boolean := false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user AND status = 'active') THEN RAISE EXCEPTION 'account_unavailable'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request_id'; END IF;
  IF p_platform NOT IN ('ios', 'android', 'web', 'unknown') THEN RAISE EXCEPTION 'invalid_platform'; END IF;
  IF length(btrim(coalesce(p_device_label, ''))) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid_device_label'; END IF;

  INSERT INTO public.user_sessions(user_id, request_id, device_label, platform)
    VALUES (v_user, p_request_id, btrim(p_device_label), p_platform)
    ON CONFLICT (user_id, request_id) DO NOTHING
    RETURNING * INTO v_session;
  IF NOT FOUND THEN
    v_already := true;
    SELECT * INTO v_session FROM public.user_sessions WHERE user_id = v_user AND request_id = p_request_id FOR UPDATE;
  END IF;
  IF v_session.ended_at IS NOT NULL THEN RAISE EXCEPTION 'session_already_ended'; END IF;
  IF NOT v_already THEN
    INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_user, 'session_started', 'user_session', v_session.id, jsonb_build_object('platform', v_session.platform));
  END IF;
  RETURN jsonb_build_object('session_id', v_session.id, 'already_done', v_already);
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_user uuid := auth.uid(); v_session public.user_sessions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_session FROM public.user_sessions WHERE id = p_session_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_session.ended_at IS NOT NULL THEN RETURN jsonb_build_object('active', false, 'already_done', true); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user AND status = 'active') THEN
    UPDATE public.user_sessions SET ended_at = now(), end_reason = 'revoked' WHERE id = p_session_id;
    RETURN jsonb_build_object('active', false, 'account_unavailable', true);
  END IF;
  IF v_session.last_seen_at <= now() - interval '30 minutes' THEN
    UPDATE public.user_sessions SET ended_at = now(), end_reason = 'expired' WHERE id = p_session_id;
    INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id)
      VALUES (v_user, 'session_expired', 'user_session', p_session_id);
    RETURN jsonb_build_object('active', false, 'expired', true);
  END IF;
  IF v_session.last_seen_at <= now() - interval '5 minutes' THEN
    UPDATE public.user_sessions SET last_seen_at = now() WHERE id = p_session_id;
  END IF;
  RETURN jsonb_build_object('active', true, 'last_seen_at', greatest(v_session.last_seen_at, now() - interval '1 second'));
END;
$$;

CREATE OR REPLACE FUNCTION public.end_session(p_session_id uuid, p_reason text DEFAULT 'logout')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_user uuid := auth.uid(); v_session public.user_sessions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_reason NOT IN ('logout', 'expired', 'revoked', 'locked', 'password_changed') THEN RAISE EXCEPTION 'invalid_end_reason'; END IF;
  SELECT * INTO v_session FROM public.user_sessions WHERE id = p_session_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_session.ended_at IS NOT NULL THEN RETURN jsonb_build_object('ended', true, 'already_done', true); END IF;
  UPDATE public.user_sessions SET ended_at = now(), end_reason = p_reason WHERE id = p_session_id;
  INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_user, CASE p_reason WHEN 'expired' THEN 'session_expired' ELSE 'session_ended' END,
      'user_session', p_session_id, jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ended', true, 'already_done', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_sessions()
RETURNS SETOF public.user_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  RETURN QUERY SELECT * FROM public.user_sessions WHERE user_id = auth.uid()
    ORDER BY (ended_at IS NULL) DESC, last_seen_at DESC LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_other_sessions(p_current_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_user uuid := auth.uid(); v_count integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_current_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_sessions WHERE id = p_current_session_id AND user_id = v_user AND ended_at IS NULL
  ) THEN RAISE EXCEPTION 'session_not_found'; END IF;
  UPDATE public.user_sessions SET ended_at = now(), end_reason = 'revoked'
    WHERE user_id = v_user AND ended_at IS NULL AND id <> p_current_session_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN RETURN jsonb_build_object('ended_count', 0, 'already_done', true); END IF;
  INSERT INTO public.audit_events(actor_id, action, entity_type, metadata)
    VALUES (v_user, 'other_sessions_ended', 'user_session', jsonb_build_object('count', v_count));
  RETURN jsonb_build_object('ended_count', v_count, 'already_done', false);
END;
$$;

-- Admin unlock uses the existing platform_admins allow-list until M29 adds explicit role tiers.
CREATE OR REPLACE FUNCTION public.admin_unlock_login(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_admin uuid := auth.uid(); v_email text := lower(btrim(coalesce(p_email, ''))); v_removed integer;
BEGIN
  IF v_admin IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_admin) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(v_email) NOT BETWEEN 3 AND 320 THEN RAISE EXCEPTION 'invalid_email'; END IF;
  DELETE FROM public.login_attempts WHERE email_normalized = v_email;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed = 0 THEN RETURN jsonb_build_object('unlocked', true, 'already_done', true); END IF;
  INSERT INTO public.audit_events(actor_id, action, entity_type, metadata)
    VALUES (v_admin, 'login_lockout_unlocked', 'auth', jsonb_build_object('removed', v_removed));
  RETURN jsonb_build_object('unlocked', true, 'already_done', false);
END;
$$;

REVOKE ALL ON FUNCTION public.login_guard_check(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.login_guard_failure(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.login_guard_success(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_guard_check(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.login_guard_failure(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.login_guard_success(text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.start_session(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_session(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_sessions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_other_sessions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_unlock_login(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_session(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_other_sessions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlock_login(text) TO authenticated;

