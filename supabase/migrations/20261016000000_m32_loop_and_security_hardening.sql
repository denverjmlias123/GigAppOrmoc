-- Migration M32: Loop, Security and Constraint Hardening
-- 1. Add revision_feedback column to milestones
ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS revision_feedback text;

-- 2. Foreign-Key Coverage Indexes
CREATE INDEX IF NOT EXISTS idx_agreements_gig_id ON public.agreements(gig_id);
CREATE INDEX IF NOT EXISTS idx_categories_created_by ON public.categories(created_by);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_payments_milestone_id ON public.payments(milestone_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_items_profile_id ON public.portfolio_items(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_hiring_interests_category_id ON public.profile_hiring_interests(category_id);
CREATE INDEX IF NOT EXISTS idx_profile_skills_skill_id ON public.profile_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_reviews_hidden_by ON public.reviews(hidden_by);
CREATE INDEX IF NOT EXISTS idx_skills_created_by ON public.skills(created_by);
CREATE INDEX IF NOT EXISTS idx_submissions_freelancer_id ON public.submissions(freelancer_id);

-- 3. Adjust payment unique index to allow installment/multiple agreement payments while protecting milestone uniqueness
DROP INDEX IF EXISTS idx_payments_unique_open_per_milestone;
CREATE UNIQUE INDEX idx_payments_unique_open_per_milestone
  ON public.payments (agreement_id, milestone_id)
  WHERE milestone_id IS NOT NULL AND status IN ('reported_sent', 'confirmed_received');

-- 4. Grant Edge Functions service_role permission to record and query audit events
GRANT SELECT, INSERT ON TABLE public.audit_events TO service_role;

-- 5. Harden resolve_report with admin guard
CREATE OR REPLACE FUNCTION public.resolve_report(
    p_report_id UUID,
    p_status TEXT,
    p_resolution_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_report RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required: Only administrators can resolve reports.';
    END IF;

    IF p_status NOT IN ('reviewed', 'dismissed', 'action_taken') THEN
        RAISE EXCEPTION 'Invalid resolution status: %', p_status;
    END IF;

    SELECT * INTO v_report
    FROM public.reports
    WHERE id = p_report_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report not found.';
    END IF;

    UPDATE public.reports
    SET status = p_status,
        resolution_notes = p_resolution_notes,
        resolved_at = now()
    WHERE id = p_report_id;

    -- Notify the reporter that their report has been reviewed
    IF v_report.reporter_id IS NOT NULL THEN
        PERFORM public.notify(
            v_report.reporter_id,
            'report_resolved',
            'Report Update',
            'Your report regarding ' || v_report.target_type || ' has been reviewed and resolved.',
            'report',
            p_report_id,
            jsonb_build_object(
                'report_id', p_report_id,
                'status', p_status,
                'dedupe_key', 'report_resolved:' || p_report_id::text || ':' || p_status
            )
        );
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_report(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_report(UUID, TEXT, TEXT) TO authenticated;

-- 6. Update switch_mode to exclude soft-deleted gigs
CREATE OR REPLACE FUNCTION public.switch_mode(
  p_target_mode text,
  p_confirm boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_status_json jsonb;
  v_can_switch boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_target_mode NOT IN ('find_work', 'hire') THEN
    RAISE EXCEPTION 'Target mode must be find_work or hire.';
  END IF;

  -- Lock profile row
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_profile.active_mode = p_target_mode THEN
    RAISE EXCEPTION 'You are already in % mode.', p_target_mode;
  END IF;

  -- Check blockers
  v_status_json := public.get_mode_switch_status();
  v_can_switch := (v_status_json->>'can_switch')::boolean;

  IF NOT v_can_switch THEN
    RAISE EXCEPTION 'Mode switch blocked: %', v_status_json->>'blockers';
  END IF;

  IF NOT p_confirm THEN
    RAISE EXCEPTION 'Confirmation required to switch modes.';
  END IF;

  -- Single atomic transaction actions
  IF v_profile.active_mode = 'hire' THEN
    -- Cancel draft and open gigs that are NOT deleted
    UPDATE public.gigs
    SET status = 'cancelled', updated_at = now()
    WHERE client_id = v_user_id AND status IN ('draft', 'open') AND deleted_at IS NULL;

  ELSIF v_profile.active_mode = 'find_work' THEN
    -- Withdraw pending proposals
    UPDATE public.applications
    SET status = 'withdrawn', updated_at = now()
    WHERE freelancer_id = v_user_id AND status IN ('applied', 'countered');
  END IF;

  -- Update active_mode and reset cooldown timer
  UPDATE public.profiles
  SET active_mode = p_target_mode,
      mode_changed_at = now()
  WHERE id = v_user_id;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'switch_mode',
    'profiles',
    v_user_id,
    jsonb_build_object('from_mode', v_profile.active_mode, 'to_mode', p_target_mode)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.switch_mode(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_mode(text, boolean) TO authenticated;

-- 7. Update get_mode_switch_status to ignore soft-deleted gigs
CREATE OR REPLACE FUNCTION public.get_mode_switch_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_cooldown_days integer := 7;
  v_remaining_days integer := 0;
  v_can_switch boolean := true;
  v_blockers text[] := ARRAY[]::text[];
  v_active_agreements_count integer := 0;
  v_disputed_agreements_count integer := 0;
  v_pending_payments_count integer := 0;
  v_unresolved_reports_count integer := 0;
  v_pending_gigs_count integer := 0;
  v_pending_apps_count integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  IF v_profile.status <> 'active' THEN
    v_can_switch := false;
    v_blockers := array_append(v_blockers, 'Account is suspended or deactivated.');
  END IF;

  IF v_profile.mode_changed_at IS NOT NULL THEN
    IF now() < (v_profile.mode_changed_at + (v_cooldown_days || ' days')::interval) THEN
      v_remaining_days := CEIL(EXTRACT(EPOCH FROM ((v_profile.mode_changed_at + (v_cooldown_days || ' days')::interval) - now())) / 86400)::integer;
      v_can_switch := false;
      v_blockers := array_append(v_blockers, 'Mode switch cooldown is active (' || v_remaining_days || ' day(s) remaining).');
    END IF;
  END IF;

  SELECT count(*) INTO v_active_agreements_count
  FROM public.agreements
  WHERE (client_id = v_user_id OR freelancer_id = v_user_id) AND status = 'active';

  IF v_active_agreements_count > 0 THEN
    v_can_switch := false;
    v_blockers := array_append(v_blockers, 'You have ' || v_active_agreements_count || ' active agreement(s). Complete or cancel them first.');
  END IF;

  SELECT count(*) INTO v_disputed_agreements_count
  FROM public.agreements
  WHERE (client_id = v_user_id OR freelancer_id = v_user_id) AND status = 'disputed';

  IF v_disputed_agreements_count > 0 THEN
    v_can_switch := false;
    v_blockers := array_append(v_blockers, 'You have ' || v_disputed_agreements_count || ' disputed agreement(s).');
  END IF;

  SELECT count(*) INTO v_pending_payments_count
  FROM public.payments
  WHERE (payer_id = v_user_id OR payee_id = v_user_id) AND status IN ('reported_sent', 'disputed');

  IF v_pending_payments_count > 0 THEN
    v_can_switch := false;
    v_blockers := array_append(v_blockers, 'You have ' || v_pending_payments_count || ' pending or disputed payment(s).');
  END IF;

  SELECT count(*) INTO v_unresolved_reports_count
  FROM public.reports
  WHERE target_id = v_user_id AND status = 'pending';

  IF v_unresolved_reports_count > 0 THEN
    v_can_switch := false;
    v_blockers := array_append(v_blockers, 'You have ' || v_unresolved_reports_count || ' unresolved report(s) under review.');
  END IF;

  IF v_profile.active_mode = 'hire' THEN
    SELECT count(*) INTO v_pending_gigs_count
    FROM public.gigs WHERE client_id = v_user_id AND status IN ('open', 'draft') AND deleted_at IS NULL;
  ELSIF v_profile.active_mode = 'find_work' THEN
    SELECT count(*) INTO v_pending_apps_count
    FROM public.applications WHERE freelancer_id = v_user_id AND status IN ('applied', 'countered');
  END IF;

  RETURN jsonb_build_object(
    'current_mode', v_profile.active_mode,
    'can_switch', v_can_switch,
    'cooldown_remaining_days', v_remaining_days,
    'blockers', to_jsonb(v_blockers),
    'pending_gigs_count', v_pending_gigs_count,
    'pending_apps_count', v_pending_apps_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_mode_switch_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mode_switch_status() TO authenticated;

-- 8. Update admin_soft_delete_user to ignore soft-deleted gigs
CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(
  p_user_id uuid, p_confirm_email text, p_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_email text;
  v_status text;
  v_role text;
  v_super_count integer;
  v_agreement_count integer;
  v_payment_count integer;
  v_cached jsonb;
  v_cached_found boolean := false;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_user_id = v_admin THEN RAISE EXCEPTION 'cannot_delete_self'; END IF;
  IF p_request_id IS NOT NULL THEN
    SELECT p_found, p_result INTO v_cached_found, v_cached
    FROM public.get_idempotency_result(v_admin, p_request_id);
    IF v_cached_found THEN RETURN coalesce(v_cached, jsonb_build_object('already_done', true)); END IF;
  END IF;

  SELECT u.email, p.status, a.role INTO v_email, v_status, v_role
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.platform_admins a ON a.user_id = u.id
    WHERE u.id = p_user_id;
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
  UPDATE public.gigs SET status = 'cancelled', updated_at = now() WHERE client_id = p_user_id AND status = 'open' AND deleted_at IS NULL;
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
REVOKE ALL ON FUNCTION public.admin_soft_delete_user(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(uuid, text, uuid) TO authenticated;

-- 9. Update review_milestone to record revision_feedback
CREATE OR REPLACE FUNCTION public.review_milestone(
    p_milestone_id UUID,
    p_action TEXT,
    p_feedback TEXT DEFAULT NULL,
    p_request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_milestone public.milestones%ROWTYPE;
    v_agreement public.agreements%ROWTYPE;
    v_cached JSONB;
    v_cached_found BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_action NOT IN ('approve', 'request_revision') THEN
        RAISE EXCEPTION 'Action must be approve or request_revision.';
    END IF;

    IF p_request_id IS NOT NULL THEN
        SELECT p_found, p_result INTO v_cached_found, v_cached
        FROM public.get_idempotency_result(v_caller_id, p_request_id);
        IF v_cached_found THEN
            RETURN;
        END IF;
    END IF;

    SELECT * INTO v_milestone
    FROM public.milestones
    WHERE id = p_milestone_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone not found.';
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = v_milestone.agreement_id;

    IF v_agreement.client_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the client can review milestone submissions.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Cannot review milestones on a non-active agreement.';
    END IF;

    IF p_action = 'approve' THEN
        IF v_milestone.status = 'approved' THEN
            PERFORM public.store_idempotency_result(
                v_caller_id,
                p_request_id,
                'review_milestone',
                jsonb_build_object('already_done', true, 'status', 'approved')
            );
            RETURN;
        END IF;

        IF v_milestone.status <> 'submitted' THEN
            RAISE EXCEPTION 'Milestone can only be approved when status is submitted (current: %).', v_milestone.status;
        END IF;

        UPDATE public.milestones
        SET status = 'approved',
            revision_feedback = NULL,
            updated_at = now()
        WHERE id = p_milestone_id;

        INSERT INTO public.audit_events (
            event_type,
            actor_id,
            target_id,
            target_table,
            metadata
        ) VALUES (
            'milestone_approved',
            v_caller_id,
            p_milestone_id,
            'milestones',
            jsonb_build_object('agreement_id', v_agreement.id, 'seq', v_milestone.seq)
        );

        PERFORM public.notify(
            v_agreement.freelancer_id,
            'milestone_approved',
            'Milestone Approved!',
            'The client approved "' || v_milestone.title || '".',
            'agreement',
            v_agreement.id,
            jsonb_build_object(
                'milestone_id', p_milestone_id,
                'dedupe_key', 'milestone_approved:' || p_milestone_id::text
            )
        );

        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'review_milestone',
            jsonb_build_object('already_done', false, 'status', 'approved')
        );

    ELSIF p_action = 'request_revision' THEN
        IF p_feedback IS NULL OR char_length(trim(p_feedback)) < 5 THEN
            RAISE EXCEPTION 'Feedback of at least 5 characters is required when requesting a revision.';
        END IF;

        IF v_milestone.revision_count >= 2 THEN
            RAISE EXCEPTION 'Maximum revisions limit (2) reached for this milestone. Please contact support or resolve via payment.';
        END IF;

        UPDATE public.milestones
        SET status = 'revision_requested',
            revision_count = revision_count + 1,
            revision_feedback = trim(p_feedback),
            updated_at = now()
        WHERE id = p_milestone_id;

        INSERT INTO public.audit_events (
            event_type,
            actor_id,
            target_id,
            target_table,
            metadata
        ) VALUES (
            'milestone_revision_requested',
            v_caller_id,
            p_milestone_id,
            'milestones',
            jsonb_build_object('agreement_id', v_agreement.id, 'revision_count', v_milestone.revision_count + 1, 'feedback', trim(p_feedback))
        );

        PERFORM public.notify(
            v_agreement.freelancer_id,
            'milestone_revision_requested',
            'Revision Requested',
            'The client requested a revision for "' || v_milestone.title || '": ' || trim(p_feedback),
            'agreement',
            v_agreement.id,
            jsonb_build_object(
                'milestone_id', p_milestone_id,
                'feedback', trim(p_feedback),
                'revision_count', v_milestone.revision_count + 1,
                'dedupe_key', 'milestone_revision_requested:' || p_milestone_id::text || ':' || (v_milestone.revision_count + 1)::text
            )
        );

        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'review_milestone',
            jsonb_build_object('already_done', false, 'status', 'revision_requested', 'revision_count', v_milestone.revision_count + 1)
        );
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.review_milestone(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_milestone(UUID, TEXT, TEXT, UUID) TO authenticated;

-- 10. Update define_milestones to populate position and audit trail
CREATE OR REPLACE FUNCTION public.define_milestones(
    p_agreement_id UUID,
    p_milestones JSONB,
    p_request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_agreement public.agreements%ROWTYPE;
    v_milestone_count INT;
    v_sum_amount BIGINT := 0;
    v_elem JSONB;
    v_elem_amount BIGINT;
    v_elem_title TEXT;
    v_elem_desc TEXT;
    v_seq INT := 0;
    v_existing_count INT := 0;
    v_cached JSONB;
    v_cached_found BOOLEAN := false;
    v_notif_type TEXT;
    v_notif_title TEXT;
    v_notif_body TEXT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_request_id IS NOT NULL THEN
        SELECT p_found, p_result INTO v_cached_found, v_cached
        FROM public.get_idempotency_result(v_caller_id, p_request_id);
        IF v_cached_found THEN
            RETURN;
        END IF;
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_agreement.client_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the client can define milestones.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Milestones can only be set for active agreements.';
    END IF;

    IF jsonb_typeof(p_milestones) <> 'array' THEN
        RAISE EXCEPTION 'Milestones must be a JSON array.';
    END IF;

    v_milestone_count := jsonb_array_length(p_milestones);
    IF v_milestone_count < 1 OR v_milestone_count > 5 THEN
        RAISE EXCEPTION 'An agreement must have between 1 and 5 milestones.';
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
        v_elem_amount := (v_elem->>'amount')::BIGINT;
        v_elem_title  := trim(v_elem->>'title');

        IF v_elem_amount IS NULL OR v_elem_amount <= 0 THEN
            RAISE EXCEPTION 'Each milestone amount must be positive.';
        END IF;

        IF v_elem_title IS NULL OR char_length(v_elem_title) < 3 OR char_length(v_elem_title) > 120 THEN
            RAISE EXCEPTION 'Milestone title must be between 3 and 120 characters.';
        END IF;

        v_sum_amount := v_sum_amount + v_elem_amount;
    END LOOP;

    IF v_sum_amount <> v_agreement.agreed_price THEN
        RAISE EXCEPTION 'Milestone sum (%) must exactly equal agreed price (%).',
            v_sum_amount, v_agreement.agreed_price;
    END IF;

    SELECT count(*) INTO v_existing_count
    FROM public.milestones
    WHERE agreement_id = p_agreement_id;

    IF v_existing_count > 0 THEN
        IF EXISTS (
            SELECT 1 FROM public.milestones
            WHERE agreement_id = p_agreement_id
              AND status IN ('submitted', 'approved', 'revision_requested')
        ) THEN
            RAISE EXCEPTION 'Cannot redefine milestones after work has been submitted or approved.';
        END IF;
    END IF;

    DELETE FROM public.milestones WHERE agreement_id = p_agreement_id;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
        v_seq := v_seq + 1;
        v_elem_amount := (v_elem->>'amount')::BIGINT;
        v_elem_title  := trim(v_elem->>'title');
        v_elem_desc   := coalesce(trim(v_elem->>'description'), '');

        INSERT INTO public.milestones (
            agreement_id,
            seq,
            position,
            title,
            description,
            amount,
            status
        ) VALUES (
            p_agreement_id,
            v_seq,
            v_seq,
            v_elem_title,
            v_elem_desc,
            v_elem_amount,
            'pending'
        );
    END LOOP;

    INSERT INTO public.audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_caller_id,
        'define_milestones',
        'agreements',
        p_agreement_id,
        jsonb_build_object('milestones_count', v_seq, 'agreed_price', v_agreement.agreed_price)
    );

    IF v_existing_count > 0 THEN
        v_notif_type := 'milestones_updated';
        v_notif_title := 'Milestones Updated';
        v_notif_body := 'The client updated the project milestones for your active agreement.';
    ELSE
        v_notif_type := 'milestones_defined';
        v_notif_title := 'Milestones Set';
        v_notif_body := 'The client defined ' || v_seq::text || ' milestone(s) for your active agreement.';
    END IF;

    PERFORM public.notify(
        v_agreement.freelancer_id,
        v_notif_type,
        v_notif_title,
        v_notif_body,
        'agreement',
        p_agreement_id,
        jsonb_build_object(
            'agreement_id', p_agreement_id,
            'dedupe_key', 'milestones_defined:' || p_agreement_id::text || ':' || v_seq::text
        )
    );

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'define_milestones',
        jsonb_build_object('already_done', false, 'count', v_seq)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.define_milestones(UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB, UUID) TO authenticated;

-- 11. Update report_payment to support installment payments & prevent freeze
CREATE OR REPLACE FUNCTION public.report_payment(
    p_agreement_id UUID,
    p_milestone_id UUID,
    p_amount INTEGER,
    p_payment_method TEXT,
    p_reference_number TEXT,
    p_receipt_path TEXT,
    p_notes TEXT,
    p_request_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_agreement public.agreements%ROWTYPE;
    v_payment_id UUID;
    v_cached JSONB;
    v_cached_found BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be positive.';
    END IF;

    IF p_payment_method NOT IN ('gcash', 'maya', 'bank_transfer', 'cash', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    IF p_request_id IS NOT NULL THEN
        SELECT p_found, p_result INTO v_cached_found, v_cached
        FROM public.get_idempotency_result(v_caller_id, p_request_id);
        IF v_cached_found THEN
            RETURN (v_cached->>'payment_id')::UUID;
        END IF;
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_agreement.client_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the client can report external payments.';
    END IF;

    -- Allow payment reporting on active or disputed agreements (to unblock dispute resolution)
    IF v_agreement.status NOT IN ('active', 'disputed') THEN
        RAISE EXCEPTION 'Payments can only be reported for active agreements.';
    END IF;

    IF p_milestone_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.milestones
            WHERE id = p_milestone_id AND agreement_id = p_agreement_id
        ) THEN
            RAISE EXCEPTION 'Milestone does not belong to this agreement.';
        END IF;

        -- Unique open payment per milestone check
        SELECT p.id INTO v_payment_id
        FROM public.payments p
        WHERE p.agreement_id = p_agreement_id
          AND p.milestone_id = p_milestone_id
          AND p.status IN ('reported_sent', 'confirmed_received')
        LIMIT 1;

        IF v_payment_id IS NOT NULL THEN
            PERFORM public.store_idempotency_result(
                v_caller_id,
                p_request_id,
                'report_payment',
                jsonb_build_object('already_done', true, 'payment_id', v_payment_id)
            );
            RETURN v_payment_id;
        END IF;
    END IF;

    INSERT INTO public.payments (
        agreement_id,
        milestone_id,
        payer_id,
        payee_id,
        amount,
        payment_method,
        reference_number,
        receipt_path,
        notes,
        status,
        reported_at
    ) VALUES (
        p_agreement_id,
        p_milestone_id,
        v_caller_id,
        v_agreement.freelancer_id,
        p_amount,
        p_payment_method,
        coalesce(trim(p_reference_number), ''),
        p_receipt_path,
        coalesce(trim(p_notes), ''),
        'reported_sent',
        now()
    )
    RETURNING id INTO v_payment_id;

    -- If agreement was disputed due to payment dispute, reporting new payment moves it back to active
    IF v_agreement.status = 'disputed' THEN
        UPDATE public.agreements
        SET status = 'active', updated_at = now()
        WHERE id = p_agreement_id;
    END IF;

    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'payment_reported',
        v_caller_id,
        v_payment_id,
        'payments',
        jsonb_build_object('agreement_id', p_agreement_id, 'amount', p_amount, 'method', p_payment_method)
    );

    PERFORM public.notify(
        v_agreement.freelancer_id,
        'payment_reported',
        'Payment Reported',
        'Client reported an external payment of ₱' || (p_amount / 100)::text || '. Please confirm once received.',
        'agreement',
        p_agreement_id,
        jsonb_build_object(
            'payment_id', v_payment_id,
            'amount', p_amount,
            'dedupe_key', 'payment_reported:' || v_payment_id::text
        )
    );

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'report_payment',
        jsonb_build_object('already_done', false, 'payment_id', v_payment_id)
    );

    RETURN v_payment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_payment(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_payment(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
