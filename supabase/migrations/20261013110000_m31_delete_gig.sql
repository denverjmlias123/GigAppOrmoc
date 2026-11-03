-- M31: retain deleted gigs for history, notify pending applicants, and close their chats.
ALTER TABLE public.gigs
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS delete_reason text;
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS gig_title_snapshot text;
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_gigs_visible_status ON public.gigs(status, created_at DESC) WHERE deleted_at IS NULL;
DROP POLICY IF EXISTS "Anyone can view open gigs" ON public.gigs;
CREATE POLICY "Anyone can view open gigs"
  ON public.gigs FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND (status = 'open' OR client_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.get_browse_categories()
RETURNS SETOF public.categories LANGUAGE sql SECURITY DEFINER
SET search_path = public, auth, pg_temp AS $$
  SELECT c.* FROM public.categories c
  WHERE c.is_active = true AND (
    c.source = 'admin' OR (
      SELECT count(DISTINCT g.client_id) FROM public.gigs g
      WHERE g.category_id = c.id AND g.deleted_at IS NULL
        AND g.status IN ('open', 'in_progress', 'completed')
    ) >= 2
  ) ORDER BY c.name ASC;
$$;
REVOKE ALL ON FUNCTION public.get_browse_categories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_browse_categories() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_dashboard_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_latest jsonb;
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
    'active_gigs', (SELECT count(*) FROM public.gigs WHERE status = 'open' AND deleted_at IS NULL),
    'agreements_in_progress', (SELECT count(*) FROM public.agreements WHERE status = 'active'),
    'completed_agreements', (SELECT count(*) FROM public.agreements WHERE status = 'completed'),
    'open_reports', (SELECT count(*) FROM public.reports WHERE status = 'pending'),
    'locked_accounts', (SELECT count(*) FROM public.login_attempts WHERE locked_until > now()),
    'today_log_events', (SELECT count(*) FROM public.audit_events WHERE created_at >= date_trunc('day', now())),
    'latest_activity', v_latest
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_dashboard_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_metrics() TO authenticated;

-- Fail closed at the database boundary even when an old client is still running.
CREATE OR REPLACE FUNCTION public.reject_application_for_deleted_gig()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.gigs WHERE id = NEW.gig_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'gig_unavailable: This gig is no longer available.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_application_for_deleted_gig() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reject_application_for_deleted_gig ON public.applications;
CREATE TRIGGER reject_application_for_deleted_gig
  BEFORE INSERT OR UPDATE OF gig_id ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.reject_application_for_deleted_gig();


-- Keep lock order consistent: gig, then application. The original RPC is kept as an
-- internal implementation and can only be reached through these checked wrappers.
ALTER FUNCTION public.respond_to_application(uuid, text, integer, uuid) RENAME TO respond_to_application_m31_internal;
CREATE OR REPLACE FUNCTION public.respond_to_application(
  p_application_id uuid, p_action text, p_counter_price integer, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp AS $$
DECLARE v_gig_id uuid; v_gig public.gigs%ROWTYPE;
BEGIN
  SELECT gig_id INTO v_gig_id FROM public.applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.'; END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id = v_gig_id FOR UPDATE;
  IF NOT FOUND OR v_gig.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'gig_unavailable: This gig is no longer available.' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.respond_to_application_m31_internal(p_application_id, p_action, p_counter_price, p_request_id);
END;
$$;
ALTER FUNCTION public.respond_to_application(uuid, text, integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.respond_to_application(uuid, text, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_application(uuid, text, integer, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.respond_to_application_m31_internal(uuid, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_application_m31_internal(uuid, text, integer, uuid) TO postgres;
CREATE OR REPLACE FUNCTION public.respond_to_application(
  p_application_id uuid, p_action text, p_counter_price integer DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$ SELECT public.respond_to_application(p_application_id, p_action, p_counter_price, NULL::uuid); $$;
REVOKE ALL ON FUNCTION public.respond_to_application(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_application(uuid, text, integer) TO authenticated;

ALTER FUNCTION public.respond_to_counter(uuid, text, uuid) RENAME TO respond_to_counter_m31_internal;
CREATE OR REPLACE FUNCTION public.respond_to_counter(
  p_application_id uuid, p_action text, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_gig_id uuid; v_gig public.gigs%ROWTYPE;
BEGIN
  SELECT gig_id INTO v_gig_id FROM public.applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.'; END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id = v_gig_id FOR UPDATE;
  IF NOT FOUND OR v_gig.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'gig_unavailable: This gig is no longer available.' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.respond_to_counter_m31_internal(p_application_id, p_action, p_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.respond_to_counter(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_counter(uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.respond_to_counter_m31_internal(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_counter_m31_internal(uuid, text, uuid) TO postgres;
CREATE OR REPLACE FUNCTION public.respond_to_counter(p_application_id uuid, p_action text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$ SELECT public.respond_to_counter(p_application_id, p_action, NULL::uuid); $$;
REVOKE ALL ON FUNCTION public.respond_to_counter(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_counter(uuid, text) TO authenticated;

-- submit_application already locks the gig before inserting the application; the trigger above
-- ensures an application cannot be inserted after deletion. Wrap it to reject before even
-- an idempotent-existing-application return, and preserve the same gig-first lock order.
ALTER FUNCTION public.submit_application(uuid, integer, integer, text, uuid) RENAME TO submit_application_m31_internal;
CREATE OR REPLACE FUNCTION public.submit_application(
  p_gig_id uuid, p_proposed_price integer, p_estimated_days integer, p_message text, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_gig public.gigs%ROWTYPE;
BEGIN
  SELECT * INTO v_gig FROM public.gigs WHERE id = p_gig_id FOR UPDATE;
  IF NOT FOUND OR v_gig.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'gig_unavailable: This gig is no longer available.' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.submit_application_m31_internal(p_gig_id, p_proposed_price, p_estimated_days, p_message, p_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_application(uuid, integer, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_application(uuid, integer, integer, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_application_m31_internal(uuid, integer, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_application_m31_internal(uuid, integer, integer, text, uuid) TO postgres;
CREATE OR REPLACE FUNCTION public.submit_application(p_gig_id uuid, p_proposed_price integer, p_estimated_days integer, p_message text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$ SELECT public.submit_application(p_gig_id, p_proposed_price, p_estimated_days, p_message, NULL::uuid); $$;
REVOKE ALL ON FUNCTION public.submit_application(uuid, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_application(uuid, integer, integer, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.delete_gig(
  p_gig_id uuid, p_reason text DEFAULT NULL, p_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_gig public.gigs%ROWTYPE;
  v_app record;
  v_count integer := 0;
  v_result jsonb;
  v_cached jsonb;
  v_cached_found boolean := false;
  v_active_mode text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF p_reason IS NOT NULL AND char_length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'Delete reason must be 500 characters or fewer.';
  END IF;
  IF p_request_id IS NOT NULL THEN
    SELECT p_found, p_result INTO v_cached_found, v_cached
    FROM public.get_idempotency_result(v_user, p_request_id);
    IF v_cached_found THEN RETURN coalesce(v_cached, jsonb_build_object('already_done', true)); END IF;
  END IF;
  IF (SELECT count(*) FROM public.rate_limit_events
      WHERE user_id = v_user AND action = 'delete_gig' AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Gig deletion rate limit reached. Please wait before trying again.';
  END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id = p_gig_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gig not found.'; END IF;
  IF v_gig.client_id <> v_user THEN RAISE EXCEPTION 'Only the gig owner can delete this gig.'; END IF;
  SELECT active_mode INTO v_active_mode FROM public.profiles WHERE id = v_user;
  IF v_active_mode <> 'hire' THEN RAISE EXCEPTION 'Switch to Hire Someone mode to delete a gig.'; END IF;
  IF v_gig.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('deleted', true, 'already_done', true, 'applicants_notified', 0);
  END IF;
  IF v_gig.status = 'completed' THEN
    RAISE EXCEPTION 'gig_completed: Completed gigs remain available as history and cannot be deleted.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agreements WHERE gig_id = p_gig_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'gig_has_agreement: A freelancer is already hired for this gig. Cancel the agreement first.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.gigs SET deleted_at = now(), deleted_by = v_user,
    delete_reason = nullif(trim(p_reason), ''), updated_at = now() WHERE id = p_gig_id;
  INSERT INTO public.rate_limit_events(user_id, action) VALUES (v_user, 'delete_gig');

  FOR v_app IN
    SELECT id, freelancer_id FROM public.applications
    WHERE gig_id = p_gig_id AND status IN ('applied', 'countered') FOR UPDATE
  LOOP
    UPDATE public.applications SET status = 'declined', status_reason = 'gig_deleted',
      gig_title_snapshot = v_gig.title, updated_at = now()
    WHERE id = v_app.id;
    v_count := v_count + 1;
    PERFORM public.notify(v_app.freelancer_id, 'gig_deleted', 'Gig deleted',
      'The gig "' || v_gig.title || '" was deleted by the client. Your proposal was closed.',
      'application', v_app.id,
      jsonb_build_object('gig_id', p_gig_id, 'application_id', v_app.id,
        'gig_title', v_gig.title, 'deep_link', '/(tabs)/activity',
        'dedupe_key', 'gig_deleted:' || p_gig_id::text || ':' || v_app.freelancer_id::text));
  END LOOP;

  UPDATE public.applications SET gig_title_snapshot = v_gig.title
    WHERE gig_id = p_gig_id AND gig_title_snapshot IS NULL;
  UPDATE public.conversations SET closed_at = coalesce(closed_at, now()),
    closed_reason = 'gig_deleted', updated_at = now()
    WHERE application_id IN (SELECT id FROM public.applications WHERE gig_id = p_gig_id);
  INSERT INTO public.messages(conversation_id, sender_id, content, is_system)
  SELECT c.id, c.client_id, 'This gig was deleted by the client', true
  FROM public.conversations c
  JOIN public.applications a ON a.id = c.application_id
  WHERE a.gig_id = p_gig_id
    AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id AND m.is_system = true AND m.content = 'This gig was deleted by the client');

  INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user, 'gig_deleted', 'gigs', p_gig_id,
    jsonb_build_object('applicants_notified', v_count, 'had_applicants', v_count > 0,
      'title', v_gig.title, 'reason', nullif(trim(p_reason), '')));
  v_result := jsonb_build_object('deleted', true, 'already_done', false, 'applicants_notified', v_count);
  IF p_request_id IS NOT NULL THEN
    PERFORM public.store_idempotency_result(v_user, p_request_id, 'delete_gig', v_result);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_gig(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_gig(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_gig(p_gig_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$ SELECT public.delete_gig(p_gig_id, p_reason, NULL::uuid); $$;
REVOKE ALL ON FUNCTION public.delete_gig(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_gig(uuid, text) TO authenticated;

-- Chat is retained for records but becomes read-only after the gig is removed.
ALTER FUNCTION public.send_message(uuid, text, uuid) RENAME TO send_message_m31_internal;
CREATE OR REPLACE FUNCTION public.send_message(p_conversation_id uuid, p_content text, p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_conv public.conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF FOUND AND v_conv.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'conversation_closed: This conversation is read-only because the gig was deleted.' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.send_message_m31_internal(p_conversation_id, p_content, p_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.send_message(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.send_message_m31_internal(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_message_m31_internal(uuid, text, uuid) TO postgres;
CREATE OR REPLACE FUNCTION public.send_message(p_conversation_id uuid, p_content text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$ SELECT public.send_message(p_conversation_id, p_content, NULL::uuid); $$;
REVOKE ALL ON FUNCTION public.send_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text) TO authenticated;


