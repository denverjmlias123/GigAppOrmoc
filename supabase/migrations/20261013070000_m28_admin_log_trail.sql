-- M28: append-only, admin-only audit log access and missing auth/message activity.

ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS device text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.audit_events'::regclass AND conname = 'audit_events_status_check') THEN
    ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_status_check CHECK (status IN ('success', 'failure'));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON public.audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_status_created_at_idx ON public.audit_events(status, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_created_at_idx ON public.audit_events(actor_id, created_at DESC);

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
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.enrich_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email text;
  v_mode text;
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
  v_device text;
BEGIN
  IF NEW.actor_id IS NOT NULL THEN
    SELECT lower(u.email), p.active_mode
      INTO v_email, v_mode
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
      WHERE u.id = NEW.actor_id;
    IF NEW.actor_email IS NULL THEN NEW.actor_email := v_email; END IF;
    IF NEW.actor_role IS NULL THEN
      NEW.actor_role := CASE WHEN EXISTS (
        SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = NEW.actor_id
      ) THEN 'admin' ELSE v_mode END;
    END IF;
  END IF;

  IF NEW.action ILIKE '%fail%' OR NEW.action ILIKE '%locked%' OR NEW.action ILIKE '%denied%' THEN
    NEW.status := 'failure';
  END IF;

  BEGIN
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  EXCEPTION WHEN others THEN
    v_headers := '{}'::jsonb;
  END;
  v_ip := coalesce(v_headers->>'cf-connecting-ip', split_part(v_headers->>'x-forwarded-for', ',', 1));
  v_device := v_headers->>'user-agent';
  IF NEW.ip IS NULL AND length(v_ip) BETWEEN 2 AND 64 AND v_ip ~ '^[0-9a-fA-F:.]+$' THEN
    NEW.ip := v_ip;
  END IF;
  IF NEW.device IS NULL AND length(v_device) > 0 THEN
    NEW.device := left(v_device, 300);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enrich_audit_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_events_enrich_before_insert ON public.audit_events;
CREATE TRIGGER audit_events_enrich_before_insert
  BEFORE INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.enrich_audit_event();

CREATE OR REPLACE FUNCTION public.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events_are_append_only';
END;
$$;
REVOKE ALL ON FUNCTION public.reject_audit_event_mutation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_events_append_only ON public.audit_events;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_event_mutation();
REVOKE ALL ON TABLE public.audit_events FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.audit_events(actor_id, actor_email, action, entity_type, entity_id, metadata)
  VALUES (NEW.id, lower(NEW.email), 'sign_up', 'profile', NEW.id, jsonb_build_object('source', 'auth'));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_auth_user_created() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created_audit ON auth.users;
CREATE TRIGGER on_auth_user_created_audit
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.audit_auth_user_created();

CREATE OR REPLACE FUNCTION public.audit_auth_user_password_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    INSERT INTO public.audit_events(actor_id, actor_email, action, entity_type, entity_id, metadata)
    VALUES (NEW.id, lower(NEW.email), 'password_changed', 'profile', NEW.id, jsonb_build_object('source', 'auth'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_auth_user_password_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_password_changed_audit ON auth.users;
CREATE TRIGGER on_auth_user_password_changed_audit
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.audit_auth_user_password_change();

CREATE OR REPLACE FUNCTION public.audit_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id, metadata)
  VALUES (NEW.sender_id, 'message_sent', 'message', NEW.id,
    jsonb_build_object('conversation_id', NEW.conversation_id));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_message_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messages_audit_after_insert ON public.messages;
CREATE TRIGGER messages_audit_after_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.audit_message_insert();

CREATE OR REPLACE FUNCTION public.audit_ip_lockout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.locked_until IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.locked_until IS NULL OR OLD.locked_until <= now()) THEN
    INSERT INTO public.audit_events(actor_id, action, entity_type, metadata)
    VALUES (NULL, 'login_locked', 'auth', jsonb_build_object('scope', 'ip', 'lock_level', NEW.lock_level));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_ip_lockout() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS login_ip_attempts_audit_lockout ON public.login_ip_attempts;
CREATE TRIGGER login_ip_attempts_audit_lockout
  AFTER INSERT OR UPDATE ON public.login_ip_attempts
  FOR EACH ROW EXECUTE FUNCTION public.audit_ip_lockout();

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
  v_from timestamptz;
  v_to timestamptz;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid_page'; END IF;
  IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid_page_size'; END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('success', 'failure') THEN RAISE EXCEPTION 'invalid_status_filter'; END IF;
  IF length(coalesce(v_user, '')) > 320 OR length(coalesce(v_action, '')) > 100 OR
     length(coalesce(v_entity, '')) > 100 OR length(coalesce(v_search, '')) > 200 THEN
    RAISE EXCEPTION 'invalid_log_filter';
  END IF;
  IF nullif(v_filters->>'date_from', '') IS NOT NULL THEN v_from := (v_filters->>'date_from')::timestamptz; END IF;
  IF nullif(v_filters->>'date_to', '') IS NOT NULL THEN v_to := (v_filters->>'date_to')::timestamptz; END IF;
  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from > v_to THEN RAISE EXCEPTION 'invalid_date_range'; END IF;

  INSERT INTO public.audit_events(actor_id, action, entity_type, metadata)
  VALUES (auth.uid(), 'log_trail_viewed', 'audit_events',
    jsonb_build_object('page', p_page, 'page_size', p_page_size, 'filters', v_filters));

  SELECT count(*) INTO v_total
  FROM public.audit_events e
  WHERE (v_user IS NULL OR e.actor_email ILIKE '%' || v_user || '%' OR e.actor_id::text = v_user)
    AND (v_action IS NULL OR e.action ILIKE '%' || v_action || '%')
    AND (v_status IS NULL OR e.status = v_status)
    AND (v_entity IS NULL OR e.entity_type ILIKE '%' || v_entity || '%')
    AND (v_search IS NULL OR e.actor_email ILIKE '%' || v_search || '%' OR e.action ILIKE '%' || v_search || '%'
      OR e.entity_type ILIKE '%' || v_search || '%' OR e.entity_id::text ILIKE '%' || v_search || '%'
      OR coalesce(e.metadata::text, '') ILIKE '%' || v_search || '%')
    AND (lower(v_action) = 'log_trail_viewed' OR e.action <> 'log_trail_viewed')
    AND (v_from IS NULL OR e.created_at >= v_from)
    AND (v_to IS NULL OR e.created_at <= v_to);

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
        AND (lower(v_action) = 'log_trail_viewed' OR e.action <> 'log_trail_viewed')
        AND (v_from IS NULL OR e.created_at >= v_from)
        AND (v_to IS NULL OR e.created_at <= v_to)
      ORDER BY e.created_at DESC
      LIMIT p_page_size OFFSET ((p_page - 1) * p_page_size)
    ) page_rows;
  RETURN jsonb_build_object('rows', v_rows, 'total_count', v_total, 'page', p_page, 'page_size', p_page_size);
END;
$$;
REVOKE ALL ON FUNCTION public.get_log_trail(jsonb, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_log_trail(jsonb, integer, integer) TO authenticated;
