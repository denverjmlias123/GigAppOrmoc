-- M29: explicit admin tiers, guarded administration RPCs, and soft user deletion.

ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';
ALTER TABLE public.platform_admins DROP CONSTRAINT IF EXISTS platform_admins_role_check;
ALTER TABLE public.platform_admins
  ADD CONSTRAINT platform_admins_role_check CHECK (role IN ('admin', 'super_admin'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check CHECK (status IN ('active', 'suspended', 'deactivated', 'deleted'));
REVOKE UPDATE (must_change_password) ON public.profiles FROM PUBLIC, anon, authenticated;
-- PostgreSQL table-level UPDATE grants override column revokes. Replace the
-- broad profile UPDATE privilege with the explicit user-editable field list.
REVOKE UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (display_name, headline, bio, avatar_path, area, preferred_contact,
  languages, work_types, availability, experience_years, starting_rate_note,
  client_type, business_name, about_hiring, onboarding_complete)
  ON public.profiles TO authenticated;

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
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- The column-level revoke blocks direct API writes. SECURITY DEFINER admin and
-- forced-password RPCs remain able to update it through Postgres.
DROP TRIGGER IF EXISTS profiles_protect_forced_password_change ON public.profiles;

CREATE OR REPLACE FUNCTION public.enrich_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_email text; v_mode text; v_role text; v_headers jsonb := '{}'::jsonb; v_ip text; v_device text;
BEGIN
  IF NEW.actor_id IS NOT NULL THEN
    SELECT lower(u.email), p.active_mode, pa.role INTO v_email, v_mode, v_role
      FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
      LEFT JOIN public.platform_admins pa ON pa.user_id = u.id WHERE u.id = NEW.actor_id;
    IF NEW.actor_email IS NULL THEN NEW.actor_email := v_email; END IF;
    IF NEW.actor_role IS NULL THEN NEW.actor_role := coalesce(v_role, v_mode); END IF;
  END IF;
  IF NEW.action ILIKE '%fail%' OR NEW.action ILIKE '%locked%' OR NEW.action ILIKE '%denied%' THEN NEW.status := 'failure'; END IF;
  BEGIN v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  EXCEPTION WHEN others THEN v_headers := '{}'::jsonb; END;
  v_ip := coalesce(v_headers->>'cf-connecting-ip', split_part(v_headers->>'x-forwarded-for', ',', 1));
  v_device := v_headers->>'user-agent';
  IF NEW.ip IS NULL AND length(v_ip) BETWEEN 2 AND 64 AND v_ip ~ '^[0-9a-fA-F:.]+$' THEN NEW.ip := v_ip; END IF;
  IF NEW.device IS NULL AND length(v_device) > 0 THEN NEW.device := left(v_device, 300); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enrich_audit_event() FROM PUBLIC, anon, authenticated;

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
    'total_users', (SELECT count(*) FROM public.profiles WHERE status <> 'deleted'),
    'new_users_7_days', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'active_gigs', (SELECT count(*) FROM public.gigs WHERE status = 'open'),
    'agreements_in_progress', (SELECT count(*) FROM public.agreements WHERE status = 'active'),
    'completed_agreements', (SELECT count(*) FROM public.agreements WHERE status = 'completed'),
    'open_reports', (SELECT count(*) FROM public.reports WHERE status = 'pending'),
    'locked_accounts', (SELECT count(*) FROM public.login_attempts WHERE locked_until > now()),
    'today_log_events', (SELECT count(*) FROM public.audit_events WHERE created_at >= date_trunc('day', now())),
    'latest_activity', v_latest
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
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid_page'; END IF;
  IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_page_size'; END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('active', 'suspended', 'deactivated', 'deleted') THEN RAISE EXCEPTION 'invalid_status_filter'; END IF;
  IF v_mode IS NOT NULL AND v_mode NOT IN ('find_work', 'hire', 'unselected') THEN RAISE EXCEPTION 'invalid_mode_filter'; END IF;
  IF length(coalesce(v_search, '')) > 200 THEN RAISE EXCEPTION 'invalid_search'; END IF;

  SELECT count(*) INTO v_count
  FROM public.profiles p JOIN auth.users u ON u.id = p.id
  WHERE (v_search IS NULL OR lower(u.email) LIKE '%' || lower(v_search) || '%'
    OR lower(p.display_name) LIKE '%' || lower(v_search) || '%' OR p.id::text = v_search)
    AND (v_status IS NULL OR p.status = v_status)
    AND (v_mode IS NULL OR (v_mode = 'unselected' AND p.active_mode IS NULL) OR p.active_mode = v_mode);

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT p.id, u.email, p.display_name, p.area, p.active_mode, p.status, p.created_at,
      u.last_sign_in_at, p.freelancer_rating_avg, p.freelancer_rating_count,
      p.client_rating_avg, p.client_rating_count, p.must_change_password,
      pa.role AS admin_role
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.platform_admins pa ON pa.user_id = p.id
    WHERE (v_search IS NULL OR lower(u.email) LIKE '%' || lower(v_search) || '%'
      OR lower(p.display_name) LIKE '%' || lower(v_search) || '%' OR p.id::text = v_search)
      AND (v_status IS NULL OR p.status = v_status)
      AND (v_mode IS NULL OR (v_mode = 'unselected' AND p.active_mode IS NULL) OR p.active_mode = v_mode)
    ORDER BY p.created_at DESC, p.id
    LIMIT p_page_size OFFSET ((p_page - 1) * p_page_size)
  ) x;
  RETURN jsonb_build_object('rows', v_rows, 'total_count', v_count, 'page', p_page, 'page_size', p_page_size);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_email text; v_created timestamptz; v_last_sign_in timestamptz; v_admin_role text; v_sessions jsonb;
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
    'last_sign_in_at', v_last_sign_in, 'admin_role', v_admin_role, 'sessions', v_sessions);
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
  IF length(coalesce(p_area, '')) > 120 THEN RAISE EXCEPTION 'invalid_area'; END IF;
  SELECT p.status, pa.role, u.email INTO v_old_status, v_target_role, v_email
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.platform_admins pa ON pa.user_id = p.id
    WHERE p.id = p_user_id FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_target_role = 'super_admin' AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  IF p_user_id = v_admin AND p_status <> 'active' THEN RAISE EXCEPTION 'cannot_suspend_self'; END IF;
  IF v_old_status = 'deleted' THEN RAISE EXCEPTION 'user_deleted'; END IF;
  UPDATE public.profiles SET display_name = btrim(p_display_name), area = coalesce(p_area, ''), status = p_status WHERE id = p_user_id;
  IF p_status <> 'active' THEN
    UPDATE public.user_sessions SET ended_at = now(), end_reason = 'revoked'
      WHERE user_id = p_user_id AND ended_at IS NULL;
  END IF;
  INSERT INTO public.audit_events(actor_id, actor_email, action, entity_type, entity_id, metadata)
  VALUES (v_admin, (SELECT email FROM auth.users WHERE id = v_admin),
    CASE WHEN p_status = 'suspended' THEN 'user_suspended' ELSE 'user_updated' END,
    'profile', p_user_id, jsonb_build_object('email', v_email, 'old_status', v_old_status, 'status', p_status));
  RETURN jsonb_build_object('user_id', p_user_id, 'status', p_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_admin_role(p_user_id uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_role text; v_count integer;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('user', 'admin', 'super_admin') THEN RAISE EXCEPTION 'invalid_admin_role'; END IF;
  PERFORM pg_advisory_xact_lock(1717986912);
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  SELECT role INTO v_role FROM public.platform_admins WHERE user_id = p_user_id FOR UPDATE;
  IF v_role = 'super_admin' AND p_role <> 'super_admin' THEN
    SELECT count(*) INTO v_count FROM public.platform_admins WHERE role = 'super_admin';
    IF v_count <= 1 THEN RAISE EXCEPTION 'last_super_admin'; END IF;
  END IF;
  IF p_role = 'user' THEN
    DELETE FROM public.platform_admins WHERE user_id = p_user_id;
  ELSIF p_role = 'admin' THEN
    DELETE FROM public.platform_admins WHERE user_id = p_user_id;
    INSERT INTO public.platform_admins(user_id, role) VALUES (p_user_id, 'admin');
  ELSE
    INSERT INTO public.platform_admins(user_id, role) VALUES (p_user_id, 'super_admin')
      ON CONFLICT(user_id) DO UPDATE SET role = 'super_admin';
  END IF;
  INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'admin_role_changed', 'profile', p_user_id, jsonb_build_object('old_role', v_role, 'role', p_role));
  RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_force_password_change(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND status <> 'deleted' FOR UPDATE) THEN RAISE EXCEPTION 'user_not_found'; END IF;
  UPDATE public.profiles SET must_change_password = true WHERE id = p_user_id;
  INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id)
    VALUES (auth.uid(), 'password_reset_requested', 'profile', p_user_id);
  RETURN jsonb_build_object('must_change_password', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_finalize_created_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_email text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  UPDATE public.profiles SET must_change_password = true WHERE id = p_user_id;
  INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'user_created', 'profile', p_user_id, jsonb_build_object('created_email', v_email, 'must_change_password', true));
  RETURN jsonb_build_object('user_id', p_user_id, 'must_change_password', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_forced_password_change_after_auth_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    UPDATE public.profiles SET must_change_password = false
      WHERE id = NEW.id AND must_change_password = true;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_forced_password_change_after_auth_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS auth_users_clear_forced_password ON auth.users;
CREATE TRIGGER auth_users_clear_forced_password
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.clear_forced_password_change_after_auth_update();

CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(p_user_id uuid, p_confirm_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid(); v_email text; v_status text; v_role text; v_super_count integer;
  v_agreement_count integer; v_payment_count integer; v_deleted integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_user_id = v_admin THEN RAISE EXCEPTION 'cannot_delete_self'; END IF;
  PERFORM pg_advisory_xact_lock(1717986912);
  SELECT p.status, u.email, pa.role INTO v_status, v_email, v_role
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.platform_admins pa ON pa.user_id = p.id
    WHERE p.id = p_user_id FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_status = 'deleted' THEN RETURN jsonb_build_object('deleted', true, 'already_done', true); END IF;
  IF lower(btrim(coalesce(p_confirm_email, ''))) <> lower(v_email) THEN RAISE EXCEPTION 'confirmation_email_mismatch'; END IF;
  IF v_role IS NOT NULL AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  IF v_role = 'super_admin' THEN
    SELECT count(*) INTO v_super_count FROM public.platform_admins WHERE role = 'super_admin';
    IF v_super_count <= 1 THEN RAISE EXCEPTION 'last_super_admin'; END IF;
  END IF;
  SELECT count(*) INTO v_agreement_count FROM public.agreements
    WHERE status IN ('active', 'disputed') AND (client_id = p_user_id OR freelancer_id = p_user_id);
  IF v_agreement_count > 0 THEN RAISE EXCEPTION 'active_agreements_block_delete'; END IF;
  SELECT count(*) INTO v_payment_count FROM public.payments
    WHERE status IN ('reported_sent', 'disputed') AND (payer_id = p_user_id OR payee_id = p_user_id);
  IF v_payment_count > 0 THEN RAISE EXCEPTION 'pending_payments_block_delete'; END IF;

  UPDATE public.profiles SET status = 'deleted', display_name = 'Deleted user', headline = '', bio = '',
    avatar_path = NULL, area = '', preferred_contact = 'In-app chat', languages = ARRAY[]::text[],
    work_types = ARRAY[]::text[], availability = 'not_taking_work', experience_years = NULL,
    starting_rate_note = '', client_type = NULL, business_name = '', about_hiring = '', must_change_password = true
    WHERE id = p_user_id;
  UPDATE public.profile_private SET dob = DATE '1900-01-01', phone = NULL WHERE user_id = p_user_id;
  UPDATE public.gigs SET status = 'cancelled', updated_at = now() WHERE client_id = p_user_id AND status = 'open';
  UPDATE public.applications SET status = 'declined', updated_at = now()
    WHERE gig_id IN (SELECT id FROM public.gigs WHERE client_id = p_user_id AND status = 'cancelled')
      AND status IN ('applied', 'countered');
  DELETE FROM public.profile_skills WHERE profile_id = p_user_id;
  DELETE FROM public.profile_hiring_interests WHERE profile_id = p_user_id;
  DELETE FROM public.portfolio_items WHERE profile_id = p_user_id;
  UPDATE public.user_sessions SET ended_at = now(), end_reason = 'revoked'
    WHERE user_id = p_user_id AND ended_at IS NULL;
  DELETE FROM public.login_attempts WHERE email_normalized = lower(v_email);
  UPDATE auth.users SET email = 'deleted+' || p_user_id::text || '@deleted.invalid',
    raw_user_meta_data = '{}'::jsonb, phone = NULL WHERE id = p_user_id;
  DELETE FROM public.platform_admins WHERE user_id = p_user_id;
  INSERT INTO public.audit_events(actor_id, actor_email, action, entity_type, entity_id, metadata)
    VALUES (v_admin, (SELECT email FROM auth.users WHERE id = v_admin), 'user_deleted', 'profile', p_user_id,
      jsonb_build_object('former_email', v_email, 'agreements_preserved', true, 'soft_delete', true));
  RETURN jsonb_build_object('deleted', true, 'already_done', false, 'user_id', p_user_id);
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
  IF v_count > 0 THEN
    INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id, metadata)
      VALUES (auth.uid(), 'admin_sessions_revoked', 'profile', p_user_id, jsonb_build_object('count', v_count));
  END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unlock_login(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_admin uuid := auth.uid(); v_email text := lower(btrim(coalesce(p_email, ''))); v_removed integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(v_email) NOT BETWEEN 3 AND 320 THEN RAISE EXCEPTION 'invalid_email'; END IF;
  DELETE FROM public.login_attempts WHERE email_normalized = v_email;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed > 0 THEN
    INSERT INTO public.audit_events(actor_id, action, entity_type, metadata)
      VALUES (v_admin, 'login_lockout_unlocked', 'auth', jsonb_build_object('email', v_email));
  END IF;
  RETURN jsonb_build_object('unlocked', true, 'already_done', v_removed = 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_metrics() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_users(text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_user_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_admin_role(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_force_password_change(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_finalize_created_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_soft_delete_user(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_end_user_sessions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_unlock_login(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_admin_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_password_change(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finalize_created_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_end_user_sessions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlock_login(text) TO authenticated;
