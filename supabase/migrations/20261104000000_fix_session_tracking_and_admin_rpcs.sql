-- Migration 20261104000000: Fix Session Tracking and Admin RPCs
-- Restores session management and admin functions for smooth authentication and dashboard access

-- 1. Ensure user_sessions columns
ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS request_id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_reason text CHECK (end_reason IS NULL OR end_reason IN ('logout', 'expired', 'revoked', 'locked', 'password_changed')),
  ADD COLUMN IF NOT EXISTS device_label text NOT NULL DEFAULT 'This device',
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_sessions_request_unique'
  ) THEN
    ALTER TABLE public.user_sessions ADD CONSTRAINT user_sessions_request_unique UNIQUE (user_id, request_id);
  END IF;
END $$;

-- 2. Ensure audit_events columns and compatibility
ALTER TABLE public.audit_events
  ALTER COLUMN activity DROP NOT NULL,
  ALTER COLUMN affected_module DROP NOT NULL,
  ALTER COLUMN result DROP NOT NULL;

ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS device text;

ALTER TABLE public.audit_events
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

-- 3. Session RPCs
CREATE OR REPLACE FUNCTION public.start_session(
  p_device_label text DEFAULT 'This device',
  p_platform text DEFAULT 'unknown',
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session public.user_sessions%ROWTYPE;
  v_already boolean := false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user AND coalesce(is_active, true) = true) THEN
    RAISE EXCEPTION 'account_unavailable';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request_id'; END IF;
  IF p_platform NOT IN ('ios', 'android', 'web', 'unknown') THEN RAISE EXCEPTION 'invalid_platform'; END IF;
  IF length(btrim(coalesce(p_device_label, ''))) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid_device_label'; END IF;

  INSERT INTO public.user_sessions(user_id, request_id, device_label, platform, last_seen_at, started_at)
    VALUES (v_user, p_request_id, btrim(p_device_label), p_platform, now(), now())
    ON CONFLICT (user_id, request_id) DO NOTHING
    RETURNING * INTO v_session;

  IF NOT FOUND THEN
    v_already := true;
    SELECT * INTO v_session FROM public.user_sessions WHERE user_id = v_user AND request_id = p_request_id FOR UPDATE;
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'session_already_ended';
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
DECLARE
  v_user uuid := auth.uid();
  v_session public.user_sessions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_session FROM public.user_sessions WHERE id = p_session_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('active', false, 'session_not_found', true);
  END IF;
  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('active', false, 'already_done', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user AND coalesce(is_active, true) = true) THEN
    UPDATE public.user_sessions SET ended_at = now(), end_reason = 'revoked' WHERE id = p_session_id;
    RETURN jsonb_build_object('active', false, 'account_unavailable', true);
  END IF;

  UPDATE public.user_sessions SET last_seen_at = now() WHERE id = p_session_id;
  RETURN jsonb_build_object('active', true, 'last_seen_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.end_session(p_session_id uuid, p_reason text DEFAULT 'logout')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session public.user_sessions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_reason NOT IN ('logout', 'expired', 'revoked', 'locked', 'password_changed') THEN
    p_reason := 'logout';
  END IF;

  SELECT * INTO v_session FROM public.user_sessions WHERE id = p_session_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ended', true, 'session_not_found', true);
  END IF;

  UPDATE public.user_sessions SET ended_at = now(), end_reason = p_reason WHERE id = p_session_id;
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
DECLARE
  v_user uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.user_sessions SET ended_at = now(), end_reason = 'revoked'
    WHERE user_id = v_user AND ended_at IS NULL AND id <> p_current_session_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ended_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_end_user_sessions(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  UPDATE public.user_sessions SET ended_at = now(), end_reason = 'revoked'
    WHERE user_id = p_user_id AND ended_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 4. Admin Role RPCs
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid() AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.admin_dashboard_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_latest jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_latest FROM (
      SELECT id, created_at, actor_email, actor_role, action, entity_type, status
      FROM public.audit_events ORDER BY created_at DESC LIMIT 10
    ) x;
  RETURN jsonb_build_object(
    'total_users', (SELECT count(*) FROM public.profiles WHERE coalesce(status, 'active') <> 'deleted'),
    'new_users_7_days', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'active_gigs', (SELECT count(*) FROM public.gigs WHERE status = 'open'),
    'agreements_in_progress', (SELECT count(*) FROM public.agreements WHERE status = 'active'),
    'completed_agreements', (SELECT count(*) FROM public.agreements WHERE status = 'completed'),
    'open_reports', (SELECT count(*) FROM public.reports WHERE status = 'pending'),
    'locked_accounts', 0,
    'today_log_events', (SELECT count(*) FROM public.audit_events WHERE created_at >= date_trunc('day', now())),
    'latest_activity', coalesce(v_latest, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_search text := nullif(btrim(p_search), '');
  v_status text := nullif(btrim(p_status), '');
  v_mode text := nullif(btrim(p_mode), '');
  v_count bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 10000 THEN p_page := 1; END IF;
  IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN p_page_size := 25; END IF;

  SELECT count(*) INTO v_count
  FROM public.profiles p JOIN auth.users u ON u.id = p.id
  WHERE (v_search IS NULL OR lower(u.email) LIKE '%' || lower(v_search) || '%'
    OR lower(coalesce(p.display_name, '')) LIKE '%' || lower(v_search) || '%' OR p.id::text = v_search)
    AND (v_status IS NULL OR coalesce(p.status, 'active') = v_status)
    AND (v_mode IS NULL OR (v_mode = 'unselected' AND p.active_mode IS NULL) OR p.active_mode = v_mode);

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT p.id, u.email, p.display_name, p.area, p.active_mode, coalesce(p.status, 'active') as status, p.created_at,
      u.last_sign_in_at, p.freelancer_rating_avg, p.freelancer_rating_count,
      p.client_rating_avg, p.client_rating_count, coalesce(p.must_change_password, false) as must_change_password,
      pa.role AS admin_role
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.platform_admins pa ON pa.user_id = p.id
    WHERE (v_search IS NULL OR lower(u.email) LIKE '%' || lower(v_search) || '%'
      OR lower(coalesce(p.display_name, '')) LIKE '%' || lower(v_search) || '%' OR p.id::text = v_search)
      AND (v_status IS NULL OR coalesce(p.status, 'active') = v_status)
      AND (v_mode IS NULL OR (v_mode = 'unselected' AND p.active_mode IS NULL) OR p.active_mode = v_mode)
    ORDER BY p.created_at DESC, p.id
    LIMIT p_page_size OFFSET ((p_page - 1) * p_page_size)
  ) x;

  RETURN jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb), 'total_count', v_count, 'page', p_page, 'page_size', p_page_size);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_email text;
  v_created timestamptz;
  v_last_sign_in timestamptz;
  v_admin_role text;
  v_sessions jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT p.* INTO v_profile FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  SELECT email, created_at, last_sign_in_at INTO v_email, v_created, v_last_sign_in FROM auth.users WHERE id = p_user_id;
  SELECT role INTO v_admin_role FROM public.platform_admins WHERE user_id = p_user_id;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.last_seen_at DESC), '[]'::jsonb) INTO v_sessions
    FROM (SELECT id, started_at, last_seen_at, ended_at, end_reason, device_label, platform
      FROM public.user_sessions WHERE user_id = p_user_id ORDER BY last_seen_at DESC LIMIT 100) s;
  RETURN jsonb_build_object('profile', to_jsonb(v_profile), 'email', v_email, 'created_at', v_created,
    'last_sign_in_at', v_last_sign_in, 'admin_role', v_admin_role, 'sessions', coalesce(v_sessions, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid, p_display_name text, p_area text, p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_admin uuid := auth.uid(); v_target_role text; v_old_status text; v_email text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_status NOT IN ('active', 'suspended') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF length(btrim(coalesce(p_display_name, ''))) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'invalid_display_name'; END IF;
  SELECT coalesce(p.status, 'active'), pa.role, u.email INTO v_old_status, v_target_role, v_email
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.platform_admins pa ON pa.user_id = p.id
    WHERE p.id = p_user_id FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_target_role = 'super_admin' AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  IF p_user_id = v_admin AND p_status <> 'active' THEN RAISE EXCEPTION 'cannot_suspend_self'; END IF;
  UPDATE public.profiles SET display_name = btrim(p_display_name), area = coalesce(p_area, ''), status = p_status, is_active = (p_status = 'active') WHERE id = p_user_id;
  IF p_status <> 'active' THEN
    UPDATE public.user_sessions SET ended_at = now(), end_reason = 'revoked'
      WHERE user_id = p_user_id AND ended_at IS NULL;
  END IF;
  RETURN jsonb_build_object('user_id', p_user_id, 'status', p_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_log_trail(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_user text := nullif(btrim(v_filters->>'user'), '');
  v_action text := nullif(btrim(v_filters->>'action'), '');
  v_status text := nullif(btrim(v_filters->>'status'), '');
  v_entity text := nullif(btrim(v_filters->>'entity'), '');
  v_search text := nullif(btrim(v_filters->>'search'), '');
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 10000 THEN p_page := 1; END IF;
  IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 1000 THEN p_page_size := 25; END IF;

  SELECT count(*) INTO v_total
  FROM public.audit_events e
  WHERE (v_user IS NULL OR e.actor_email ILIKE '%' || v_user || '%' OR e.actor_id::text = v_user)
    AND (v_action IS NULL OR e.action ILIKE '%' || v_action || '%')
    AND (v_status IS NULL OR e.status = v_status)
    AND (v_entity IS NULL OR e.entity_type ILIKE '%' || v_entity || '%')
    AND (v_search IS NULL OR e.actor_email ILIKE '%' || v_search || '%' OR e.action ILIKE '%' || v_search || '%'
      OR e.entity_type ILIKE '%' || v_search || '%' OR e.entity_id::text ILIKE '%' || v_search || '%'
      OR coalesce(e.metadata::text, '') ILIKE '%' || v_search || '%');

  SELECT coalesce(jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT e.* FROM public.audit_events e
      WHERE (v_user IS NULL OR e.actor_email ILIKE '%' || v_user || '%' OR e.actor_id::text = v_user)
        AND (v_action IS NULL OR e.action ILIKE '%' || v_action || '%')
        AND (v_status IS NULL OR e.status = v_status)
        AND (v_entity IS NULL OR e.entity_type ILIKE '%' || v_entity || '%')
        AND (v_search IS NULL OR e.actor_email ILIKE '%' || v_search || '%' OR e.action ILIKE '%' || v_search || '%'
          OR e.entity_type ILIKE '%' || v_search || '%' OR e.entity_id::text ILIKE '%' || v_search || '%'
          OR coalesce(e.metadata::text, '') ILIKE '%' || v_search || '%')
      ORDER BY e.created_at DESC
      LIMIT p_page_size OFFSET ((p_page - 1) * p_page_size)
    ) page_rows;

  RETURN jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb), 'total_count', v_total, 'page', p_page, 'page_size', p_page_size);
END;
$$;

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
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_action NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'invalid_action'; END IF;

  UPDATE public.profiles
  SET is_legit_verified = (p_action = 'approve'),
      verification_status = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
      verification_notes = coalesce(p_notes, verification_notes),
      verified_at = CASE WHEN p_action = 'approve' THEN now() ELSE verified_at END,
      updated_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('user_id', p_user_id, 'action', p_action);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_backups()
RETURNS SETOF public.database_backups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  RETURN QUERY SELECT * FROM public.database_backups ORDER BY created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_authenticated_session_valid()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    LEFT JOIN public.login_security_state lss ON lss.user_id = p.id
    WHERE p.id = auth.uid()
      AND coalesce(p.is_active, true) = true
      AND coalesce(p.is_admin_locked, false) = false
      AND (lss.locked_until IS NULL OR lss.locked_until <= now())
  );
END;
$$;

-- 5. Privileges
REVOKE ALL ON FUNCTION public.start_session(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_session(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_sessions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_other_sessions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_end_user_sessions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_dashboard_metrics() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_users(text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_user_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_log_trail(jsonb, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_decide_verification(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_backups() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_session(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_other_sessions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_end_user_sessions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_log_trail(jsonb, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_verification(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_backups() TO authenticated;
