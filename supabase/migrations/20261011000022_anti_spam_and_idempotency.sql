-- Migration: 20261011000022_anti_spam_and_idempotency.sql
-- Milestone 24: Stop Spam Clicks and Two-Device Duplicates
-- Strictly adheres to docs/RESILIENCE_V5_4.md Section 3B & 3C and docs/MILESTONES.md (M24)

-- ============================================================================
-- 1. Idempotency Keys Table & Internal Helpers
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    rpc_name TEXT NOT NULL,
    result JSONB NOT NULL DEFAULT 'null'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at
    ON public.idempotency_keys (created_at);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Internal only: RLS enabled with zero policies and all privileges revoked from client roles
REVOKE ALL ON public.idempotency_keys FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_idempotency_result(
    p_user_id UUID,
    p_request_id UUID,
    OUT p_found BOOLEAN,
    OUT p_result JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    p_found := false;
    p_result := NULL;
    IF p_user_id IS NULL OR p_request_id IS NULL THEN
        RETURN;
    END IF;

    SELECT true, ik.result
    INTO p_found, p_result
    FROM public.idempotency_keys ik
    WHERE ik.user_id = p_user_id AND ik.request_id = p_request_id;

    IF NOT FOUND THEN
        p_found := false;
        p_result := NULL;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_idempotency_result(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.store_idempotency_result(
    p_user_id UUID,
    p_request_id UUID,
    p_rpc_name TEXT,
    p_result JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_user_id IS NULL OR p_request_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO public.idempotency_keys (user_id, request_id, rpc_name, result)
    VALUES (p_user_id, p_request_id, p_rpc_name, coalesce(p_result, 'null'::jsonb))
    ON CONFLICT (user_id, request_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.store_idempotency_result(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_expired_idempotency_keys()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.idempotency_keys
    WHERE created_at < (now() - interval '24 hours');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_idempotency_keys() FROM PUBLIC, anon, authenticated;

-- Schedule 24h cleanup in pg_cron when available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'cleanup-idempotency-keys-hourly',
            '0 * * * *',
            $cron$SELECT public.cleanup_expired_idempotency_keys();$cron$
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;

-- ============================================================================
-- 2. Unique Indexes & Notification Deduplication
-- ============================================================================

-- Backfill any null submission_number values deterministically before creating unique index
WITH numbered AS (
    SELECT id,
           row_number() OVER (PARTITION BY milestone_id ORDER BY created_at ASC, id ASC) AS rn
    FROM public.submissions
    WHERE submission_number IS NULL
)
UPDATE public.submissions s
SET submission_number = n.rn
FROM numbered n
WHERE s.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_milestone_submission_number
    ON public.submissions (milestone_id, submission_number)
    WHERE submission_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_open_per_milestone
    ON public.payments (
        agreement_id,
        COALESCE(milestone_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE status IN ('reported_sent', 'confirmed_received');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique_agreement_reviewer
    ON public.reviews (agreement_id, reviewer_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_unique_active_per_gig
    ON public.applications (gig_id, freelancer_id)
    WHERE status IN ('applied', 'countered', 'accepted');

-- Add dedupe_key to notifications and unique partial index per user
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS dedupe_key TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe_key
    ON public.notifications (user_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- Update public.notify() to compute/use dedupe_key and ON CONFLICT DO NOTHING
CREATE OR REPLACE FUNCTION public.notify(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_body TEXT,
    p_entity_type TEXT DEFAULT NULL,
    p_entity_id UUID DEFAULT NULL,
    p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_notification_id UUID;
    v_actor_id UUID;
    v_dedupe_key TEXT;
    v_state_suffix TEXT;
BEGIN
    v_actor_id := auth.uid();

    -- Rule: Never notify the actor about their own action
    IF v_actor_id IS NOT NULL AND p_user_id = v_actor_id THEN
        RETURN NULL;
    END IF;

    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Derive deterministic dedupe_key (type:entity_id:state) when entity_id is present
    IF p_data IS NOT NULL AND (p_data ? 'dedupe_key') THEN
        v_dedupe_key := NULLIF(trim(p_data->>'dedupe_key'), '');
    ELSIF p_entity_id IS NOT NULL AND p_type <> 'new_message' THEN
        v_state_suffix := coalesce(
            p_data->>'submission_id',
            p_data->>'revision_count',
            p_data->>'payment_id',
            p_data->>'counter_price',
            ''
        );
        IF v_state_suffix <> '' THEN
            v_dedupe_key := p_type || ':' || p_entity_id::text || ':' || v_state_suffix;
        ELSE
            v_dedupe_key := p_type || ':' || p_entity_id::text;
        END IF;
    ELSIF p_type = 'new_message' AND p_data IS NOT NULL AND (p_data ? 'message_id') THEN
        v_dedupe_key := 'new_message:' || (p_data->>'message_id');
    END IF;

    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        body,
        entity_type,
        entity_id,
        data,
        dedupe_key
    ) VALUES (
        p_user_id,
        p_type,
        trim(p_title),
        trim(p_body),
        p_entity_type,
        p_entity_id,
        coalesce(p_data, '{}'::jsonb),
        v_dedupe_key
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$$;

REVOKE ALL ON FUNCTION public.notify(UUID, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. State-Changing RPCs with Idempotency Keys & State-Machine Guards
-- ============================================================================

-- 3.1 review_milestone
CREATE OR REPLACE FUNCTION public.review_milestone(
    p_milestone_id UUID,
    p_action TEXT,
    p_feedback TEXT,
    p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_milestone RECORD;
    v_agreement RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_action NOT IN ('approve', 'request_revision') THEN
        RAISE EXCEPTION 'Action must be either "approve" or "request_revision".';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found THEN
        RETURN;
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
    WHERE id = v_milestone.agreement_id
    FOR UPDATE;

    IF v_agreement.client_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the client can review milestone submissions.';
    END IF;

    -- State-machine idempotent guard: approving twice or requesting revision twice does nothing
    IF (p_action = 'approve' AND v_milestone.status = 'approved')
       OR (p_action = 'request_revision' AND v_milestone.status = 'revision_requested') THEN
        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'review_milestone',
            jsonb_build_object('already_done', true, 'status', v_milestone.status)
        );
        RETURN;
    END IF;

    IF v_milestone.status <> 'submitted' THEN
        RAISE EXCEPTION 'Only submitted milestones can be reviewed.';
    END IF;

    IF p_action = 'approve' THEN
        UPDATE public.milestones
        SET status = 'approved',
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
            jsonb_build_object('agreement_id', v_agreement.id)
        );

        PERFORM public.notify(
            v_agreement.freelancer_id,
            'milestone_approved',
            'Milestone Approved!',
            'Your milestone "' || v_milestone.title || '" has been approved by the client.',
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
            jsonb_build_object('agreement_id', v_agreement.id, 'revision_count', v_milestone.revision_count + 1)
        );

        PERFORM public.notify(
            v_agreement.freelancer_id,
            'milestone_revision_requested',
            'Revision Requested',
            'The client requested a revision for "' || v_milestone.title || '".',
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

CREATE OR REPLACE FUNCTION public.review_milestone(
    p_milestone_id UUID,
    p_action TEXT,
    p_feedback TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public.review_milestone(p_milestone_id, p_action, p_feedback, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.review_milestone(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_milestone(UUID, TEXT, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.review_milestone(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_milestone(UUID, TEXT, TEXT) TO authenticated;

-- 3.2 submit_milestone
CREATE OR REPLACE FUNCTION public.submit_milestone(
    p_milestone_id UUID,
    p_message TEXT,
    p_file_paths TEXT[],
    p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_milestone RECORD;
    v_agreement RECORD;
    v_submission_id UUID;
    v_next_sub_num INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_message IS NULL OR char_length(trim(p_message)) < 5 THEN
        RAISE EXCEPTION 'Submission text must be at least 5 characters.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found AND v_idem_result IS NOT NULL AND (v_idem_result ? 'submission_id') THEN
        RETURN (v_idem_result->>'submission_id')::UUID;
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
    WHERE id = v_milestone.agreement_id
    FOR UPDATE;

    IF v_agreement.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the assigned freelancer can submit work for this milestone.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Milestones can only be submitted for active agreements.';
    END IF;

    -- State-machine idempotent guard: if already submitted, return existing latest submission_id
    IF v_milestone.status = 'submitted' THEN
        SELECT s.id INTO v_submission_id
        FROM public.submissions s
        WHERE s.milestone_id = p_milestone_id
        ORDER BY s.submission_number DESC NULLS LAST, s.created_at DESC
        LIMIT 1;

        IF v_submission_id IS NOT NULL THEN
            PERFORM public.store_idempotency_result(
                v_caller_id,
                p_request_id,
                'submit_milestone',
                jsonb_build_object('already_done', true, 'submission_id', v_submission_id)
            );
            RETURN v_submission_id;
        END IF;
    END IF;

    IF v_milestone.status NOT IN ('pending', 'revision_requested') THEN
        RAISE EXCEPTION 'Milestone cannot be submitted in its current status (%).', v_milestone.status;
    END IF;

    SELECT coalesce(max(s.submission_number), 0) + 1
    INTO v_next_sub_num
    FROM public.submissions s
    WHERE s.milestone_id = p_milestone_id;

    INSERT INTO public.submissions (
        milestone_id,
        freelancer_id,
        submission_number,
        message,
        notes,
        file_paths
    ) VALUES (
        p_milestone_id,
        v_caller_id,
        v_next_sub_num,
        trim(p_message),
        trim(p_message),
        coalesce(p_file_paths, ARRAY[]::TEXT[])
    )
    RETURNING id INTO v_submission_id;

    UPDATE public.milestones
    SET status = 'submitted',
        updated_at = now()
    WHERE id = p_milestone_id;

    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'milestone_submitted',
        v_caller_id,
        v_submission_id,
        'submissions',
        jsonb_build_object('milestone_id', p_milestone_id, 'agreement_id', v_agreement.id, 'submission_number', v_next_sub_num)
    );

    PERFORM public.notify(
        v_agreement.client_id,
        'milestone_submitted',
        'Milestone Submitted',
        'Work has been submitted for milestone "' || v_milestone.title || '".',
        'agreement',
        v_agreement.id,
        jsonb_build_object(
            'milestone_id', p_milestone_id,
            'submission_id', v_submission_id,
            'dedupe_key', 'milestone_submitted:' || p_milestone_id::text || ':' || v_next_sub_num::text
        )
    );

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'submit_milestone',
        jsonb_build_object('already_done', false, 'submission_id', v_submission_id)
    );

    RETURN v_submission_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_milestone(
    p_milestone_id UUID,
    p_message TEXT,
    p_file_paths TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.submit_milestone(p_milestone_id, p_message, coalesce(p_file_paths, ARRAY[]::TEXT[]), NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_milestone(UUID, TEXT, TEXT[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_milestone(UUID, TEXT, TEXT[], UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_milestone(UUID, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_milestone(UUID, TEXT, TEXT[]) TO authenticated;

-- 3.3 define_milestones
CREATE OR REPLACE FUNCTION public.define_milestones(
    p_agreement_id UUID,
    p_milestones JSONB,
    p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_agreement RECORD;
    v_total_amount INTEGER := 0;
    v_elem JSONB;
    v_pos INTEGER := 1;
    v_existing_count INTEGER;
    v_non_pending_count INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found THEN
        RETURN;
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
        RAISE EXCEPTION 'Milestones can only be defined on active agreements.';
    END IF;

    SELECT count(*), count(*) FILTER (WHERE status <> 'pending')
    INTO v_existing_count, v_non_pending_count
    FROM public.milestones
    WHERE agreement_id = p_agreement_id;

    IF v_non_pending_count > 0 THEN
        RAISE EXCEPTION 'Milestones cannot be modified after work has been submitted or approved.';
    END IF;

    -- If milestones are already defined and all pending, second concurrent call is a no-op (already_done)
    IF v_existing_count > 0 THEN
        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'define_milestones',
            jsonb_build_object('already_done', true, 'milestone_count', v_existing_count)
        );
        RETURN;
    END IF;

    IF jsonb_array_length(p_milestones) < 1 OR jsonb_array_length(p_milestones) > 5 THEN
        RAISE EXCEPTION 'Agreement must have between 1 and 5 milestones.';
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
        IF (v_elem->>'title') IS NULL OR char_length(trim(v_elem->>'title')) < 3 THEN
            RAISE EXCEPTION 'Each milestone must have a title of at least 3 characters.';
        END IF;
        IF (v_elem->>'amount') IS NULL OR (v_elem->>'amount')::integer <= 0 THEN
            RAISE EXCEPTION 'Milestone amount must be greater than zero.';
        END IF;
        v_total_amount := v_total_amount + (v_elem->>'amount')::integer;
    END LOOP;

    IF v_total_amount <> v_agreement.agreed_price THEN
        RAISE EXCEPTION 'Sum of milestone amounts (%) must exactly equal agreed price (%).',
            v_total_amount, v_agreement.agreed_price;
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
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
            v_pos,
            v_pos,
            trim(v_elem->>'title'),
            coalesce(trim(v_elem->>'description'), ''),
            (v_elem->>'amount')::integer,
            'pending'
        );
        v_pos := v_pos + 1;
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
        jsonb_build_object('milestone_count', jsonb_array_length(p_milestones), 'total_amount', v_total_amount)
    );

    PERFORM public.notify(
        v_agreement.freelancer_id,
        'milestones_defined',
        'Milestones Defined',
        'Milestones have been defined for your active agreement.',
        'agreement',
        p_agreement_id,
        jsonb_build_object('dedupe_key', 'milestones_defined:' || p_agreement_id::text)
    );

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'define_milestones',
        jsonb_build_object('already_done', false, 'milestone_count', jsonb_array_length(p_milestones))
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.define_milestones(
    p_agreement_id UUID,
    p_milestones JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public.define_milestones(p_agreement_id, p_milestones, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB) TO authenticated;

-- 3.4 respond_to_application
CREATE OR REPLACE FUNCTION public.respond_to_application(
    p_application_id UUID,
    p_action TEXT,
    p_counter_price INTEGER,
    p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_app RECORD;
    v_gig RECORD;
    v_agreement_id UUID;
    v_other_app RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_action NOT IN ('accept', 'decline', 'counter') THEN
        RAISE EXCEPTION 'Invalid response action. Must be accept, decline, or counter.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_user_id, p_request_id);
    IF v_idem_found THEN
        IF v_idem_result IS NOT NULL AND (v_idem_result ? 'agreement_id') AND v_idem_result->>'agreement_id' IS NOT NULL THEN
            RETURN (v_idem_result->>'agreement_id')::UUID;
        END IF;
        RETURN NULL;
    END IF;

    SELECT * INTO v_app
    FROM public.applications
    WHERE id = p_application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found.';
    END IF;

    SELECT * INTO v_gig
    FROM public.gigs
    WHERE id = v_app.gig_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gig not found.';
    END IF;

    IF v_gig.client_id <> v_user_id THEN
        RAISE EXCEPTION 'Only the gig client can respond to this application.';
    END IF;

    -- State-machine idempotent guard for second concurrent call
    IF p_action = 'accept' AND v_app.status = 'accepted' THEN
        SELECT id INTO v_agreement_id
        FROM public.agreements
        WHERE gig_id = v_gig.id AND status = 'active'
        LIMIT 1;

        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_application',
            jsonb_build_object('already_done', true, 'agreement_id', v_agreement_id)
        );
        RETURN v_agreement_id;
    ELSIF p_action = 'decline' AND v_app.status = 'declined' THEN
        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_application',
            jsonb_build_object('already_done', true, 'agreement_id', NULL)
        );
        RETURN NULL;
    ELSIF p_action = 'counter' AND v_app.status = 'countered' THEN
        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_application',
            jsonb_build_object('already_done', true, 'agreement_id', NULL)
        );
        RETURN NULL;
    END IF;

    IF v_app.status <> 'applied' THEN
        RAISE EXCEPTION 'Application is not in applied state (current: %).', v_app.status;
    END IF;

    IF p_action = 'counter' THEN
        IF p_counter_price IS NULL OR p_counter_price <= 0 THEN
            RAISE EXCEPTION 'Counter price must be greater than zero.';
        END IF;

        UPDATE public.applications
        SET status = 'countered',
            counter_price = p_counter_price,
            updated_at = now()
        WHERE id = p_application_id;

        INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
        VALUES (v_user_id, 'counter_application', 'applications', p_application_id, jsonb_build_object('counter_price', p_counter_price));

        PERFORM public.notify(
            v_app.freelancer_id,
            'application_countered',
            'Counteroffer Received',
            'The client countered your proposal on "' || v_gig.title || '".',
            'application',
            p_application_id,
            jsonb_build_object('counter_price', p_counter_price, 'gig_id', v_gig.id)
        );

        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_application',
            jsonb_build_object('already_done', false, 'agreement_id', NULL)
        );

        RETURN NULL;

    ELSIF p_action = 'decline' THEN
        UPDATE public.applications
        SET status = 'declined',
            updated_at = now()
        WHERE id = p_application_id;

        INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
        VALUES (v_user_id, 'decline_application', 'applications', p_application_id, '{}'::jsonb);

        PERFORM public.notify(
            v_app.freelancer_id,
            'application_declined',
            'Application Update',
            'Your application for "' || v_gig.title || '" was not accepted.',
            'application',
            p_application_id,
            jsonb_build_object('gig_id', v_gig.id)
        );

        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_application',
            jsonb_build_object('already_done', false, 'agreement_id', NULL)
        );

        RETURN NULL;

    ELSIF p_action = 'accept' THEN
        IF v_gig.status <> 'open' THEN
            RAISE EXCEPTION 'Gig is not open (current: %). Cannot accept application.', v_gig.status;
        END IF;

        UPDATE public.applications
        SET status = 'accepted',
            updated_at = now()
        WHERE id = p_application_id;

        INSERT INTO public.agreements (
            gig_id,
            client_id,
            freelancer_id,
            agreed_price,
            deadline
        ) VALUES (
            v_gig.id,
            v_gig.client_id,
            v_app.freelancer_id,
            v_app.proposed_price,
            v_gig.deadline
        )
        RETURNING id INTO v_agreement_id;

        UPDATE public.gigs
        SET status = 'in_progress',
            updated_at = now()
        WHERE id = v_gig.id;

        FOR v_other_app IN
            SELECT id, freelancer_id FROM public.applications
            WHERE gig_id = v_gig.id
              AND id <> p_application_id
              AND status IN ('applied', 'countered')
        LOOP
            UPDATE public.applications
            SET status = 'declined',
                updated_at = now()
            WHERE id = v_other_app.id;

            PERFORM public.notify(
                v_other_app.freelancer_id,
                'application_declined',
                'Gig Filled',
                'Another proposal was selected for "' || v_gig.title || '".',
                'application',
                v_other_app.id,
                jsonb_build_object('gig_id', v_gig.id)
            );
        END LOOP;

        INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
        VALUES (
            v_user_id,
            'accept_application',
            'agreements',
            v_agreement_id,
            jsonb_build_object('application_id', p_application_id, 'agreed_price', v_app.proposed_price)
        );

        PERFORM public.notify(
            v_app.freelancer_id,
            'application_accepted',
            'Proposal Accepted!',
            'Congratulations! Your proposal for "' || v_gig.title || '" was accepted.',
            'agreement',
            v_agreement_id,
            jsonb_build_object('gig_id', v_gig.id)
        );

        PERFORM public.notify(
            v_user_id,
            'agreement_created',
            'Agreement Created',
            'Agreement for "' || v_gig.title || '" is now active.',
            'agreement',
            v_agreement_id,
            jsonb_build_object('gig_id', v_gig.id)
        );

        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_application',
            jsonb_build_object('already_done', false, 'agreement_id', v_agreement_id)
        );

        RETURN v_agreement_id;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_application(
    p_application_id UUID,
    p_action TEXT,
    p_counter_price INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.respond_to_application(p_application_id, p_action, p_counter_price, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.respond_to_application(UUID, TEXT, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_application(UUID, TEXT, INTEGER, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.respond_to_application(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_application(UUID, TEXT, INTEGER) TO authenticated;

-- 3.5 respond_to_counter
CREATE OR REPLACE FUNCTION public.respond_to_counter(
    p_application_id UUID,
    p_action TEXT,
    p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_app RECORD;
    v_gig RECORD;
    v_agreement_id UUID;
    v_other_app RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_action NOT IN ('accept', 'decline', 'withdraw') THEN
        RAISE EXCEPTION 'Invalid counter response. Must be accept, decline, or withdraw.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_user_id, p_request_id);
    IF v_idem_found THEN
        IF v_idem_result IS NOT NULL AND (v_idem_result ? 'agreement_id') AND v_idem_result->>'agreement_id' IS NOT NULL THEN
            RETURN (v_idem_result->>'agreement_id')::UUID;
        END IF;
        RETURN NULL;
    END IF;

    SELECT * INTO v_app
    FROM public.applications
    WHERE id = p_application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found.';
    END IF;

    IF v_app.freelancer_id <> v_user_id THEN
        RAISE EXCEPTION 'Only the applicant freelancer can respond to this counteroffer.';
    END IF;

    SELECT * INTO v_gig
    FROM public.gigs
    WHERE id = v_app.gig_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gig not found.';
    END IF;

    -- State-machine idempotent guard
    IF p_action = 'accept' AND v_app.status = 'accepted' THEN
        SELECT id INTO v_agreement_id
        FROM public.agreements
        WHERE gig_id = v_gig.id AND status = 'active'
        LIMIT 1;

        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_counter',
            jsonb_build_object('already_done', true, 'agreement_id', v_agreement_id)
        );
        RETURN v_agreement_id;
    ELSIF p_action IN ('decline', 'withdraw') AND v_app.status IN ('decline', 'declined', 'withdraw', 'withdrawn') THEN
        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_counter',
            jsonb_build_object('already_done', true, 'agreement_id', NULL)
        );
        RETURN NULL;
    END IF;

    IF v_app.status <> 'countered' THEN
        RAISE EXCEPTION 'Application is not in countered status (current: %).', v_app.status;
    END IF;

    IF p_action IN ('decline', 'withdraw') THEN
        UPDATE public.applications
        SET status = CASE WHEN p_action = 'decline' THEN 'declined' ELSE 'withdrawn' END,
            updated_at = now()
        WHERE id = p_application_id;

        INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
        VALUES (
            v_user_id,
            p_action || '_counter',
            'applications',
            p_application_id,
            jsonb_build_object('gig_id', v_gig.id)
        );

        PERFORM public.notify(
            v_gig.client_id,
            'counter_declined',
            'Counteroffer Declined',
            'Freelancer declined the counteroffer for "' || v_gig.title || '".',
            'application',
            p_application_id,
            jsonb_build_object('gig_id', v_gig.id)
        );

        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_counter',
            jsonb_build_object('already_done', false, 'agreement_id', NULL)
        );

        RETURN NULL;

    ELSIF p_action = 'accept' THEN
        IF v_gig.status <> 'open' THEN
            RAISE EXCEPTION 'Gig is not open (current: %). An active agreement may already exist.', v_gig.status;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.agreements
            WHERE gig_id = v_gig.id AND status = 'active'
        ) THEN
            RAISE EXCEPTION 'An active agreement already exists for this gig.';
        END IF;

        IF v_gig.client_id = v_user_id THEN
            RAISE EXCEPTION 'Client and freelancer cannot be the same person.';
        END IF;

        UPDATE public.applications
        SET status = 'accepted',
            updated_at = now()
        WHERE id = p_application_id;

        INSERT INTO public.agreements (
            gig_id,
            client_id,
            freelancer_id,
            agreed_price,
            deadline,
            status
        )
        VALUES (
            v_gig.id,
            v_gig.client_id,
            v_user_id,
            v_app.counter_price,
            v_gig.deadline,
            'active'
        )
        RETURNING id INTO v_agreement_id;

        UPDATE public.gigs
        SET status = 'in_progress',
            updated_at = now()
        WHERE id = v_gig.id;

        FOR v_other_app IN
            SELECT id, freelancer_id FROM public.applications
            WHERE gig_id = v_gig.id
              AND id <> p_application_id
              AND status IN ('applied', 'countered')
        LOOP
            UPDATE public.applications
            SET status = 'declined',
                updated_at = now()
            WHERE id = v_other_app.id;

            PERFORM public.notify(
                v_other_app.freelancer_id,
                'application_declined',
                'Gig Filled',
                'Another proposal was accepted for "' || v_gig.title || '".',
                'application',
                v_other_app.id,
                jsonb_build_object('gig_id', v_gig.id)
            );
        END LOOP;

        INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
        VALUES (
            v_user_id,
            'accept_counter',
            'agreements',
            v_agreement_id,
            jsonb_build_object('gig_id', v_gig.id, 'price', v_app.counter_price)
        );

        PERFORM public.notify(
            v_gig.client_id,
            'counter_accepted',
            'Counteroffer Accepted!',
            'Freelancer accepted your counteroffer for "' || v_gig.title || '". Agreement is now active.',
            'agreement',
            v_agreement_id,
            jsonb_build_object('gig_id', v_gig.id)
        );

        PERFORM public.notify(
            v_gig.client_id,
            'agreement_created',
            'Agreement Created',
            'Agreement for "' || v_gig.title || '" is now active.',
            'agreement',
            v_agreement_id,
            jsonb_build_object('gig_id', v_gig.id)
        );

        PERFORM public.notify(
            v_user_id,
            'agreement_created',
            'Agreement Created',
            'Agreement for "' || v_gig.title || '" is now active.',
            'agreement',
            v_agreement_id,
            jsonb_build_object('gig_id', v_gig.id)
        );

        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'respond_to_counter',
            jsonb_build_object('already_done', false, 'agreement_id', v_agreement_id)
        );

        RETURN v_agreement_id;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_counter(
    p_application_id UUID,
    p_action TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.respond_to_counter(p_application_id, p_action, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.respond_to_counter(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_counter(UUID, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.respond_to_counter(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_counter(UUID, TEXT) TO authenticated;

-- 3.6 report_payment
CREATE OR REPLACE FUNCTION public.report_payment(
    p_agreement_id UUID,
    p_milestone_id UUID,
    p_amount INTEGER,
    p_payment_method TEXT,
    p_reference_number TEXT,
    p_receipt_path TEXT,
    p_notes TEXT,
    p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_agreement RECORD;
    v_payment_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;

    IF p_reference_number IS NULL OR char_length(trim(p_reference_number)) < 3 THEN
        RAISE EXCEPTION 'A valid transaction reference number is required.';
    END IF;

    IF p_payment_method NOT IN ('gcash', 'maya', 'bank_transfer', 'cash', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found AND v_idem_result IS NOT NULL AND (v_idem_result ? 'payment_id') THEN
        RETURN (v_idem_result->>'payment_id')::UUID;
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

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Payments can only be reported for active agreements.';
    END IF;

    IF p_milestone_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.milestones
            WHERE id = p_milestone_id AND agreement_id = p_agreement_id
        ) THEN
            RAISE EXCEPTION 'Milestone does not belong to this agreement.';
        END IF;
    END IF;

    -- State-machine idempotent guard: unique open payment per (agreement, milestone) while reported_sent or confirmed_received
    SELECT p.id INTO v_payment_id
    FROM public.payments p
    WHERE p.agreement_id = p_agreement_id
      AND COALESCE(p.milestone_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_milestone_id, '00000000-0000-0000-0000-000000000000'::uuid)
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

CREATE OR REPLACE FUNCTION public.report_payment(
    p_agreement_id UUID,
    p_milestone_id UUID DEFAULT NULL,
    p_amount INTEGER DEFAULT 0,
    p_payment_method TEXT DEFAULT 'gcash',
    p_reference_number TEXT DEFAULT '',
    p_receipt_path TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.report_payment(
        p_agreement_id,
        p_milestone_id,
        p_amount,
        p_payment_method,
        p_reference_number,
        p_receipt_path,
        p_notes,
        NULL::UUID
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_payment(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_payment(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.report_payment(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_payment(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 3.7 confirm_payment
CREATE OR REPLACE FUNCTION public.confirm_payment(
    p_payment_id UUID,
    p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_payment RECORD;
    v_agreement RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found THEN
        RETURN;
    END IF;

    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found.';
    END IF;

    IF v_payment.payee_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the payee freelancer can confirm payment receipt.';
    END IF;

    IF v_payment.status = 'confirmed_received' THEN
        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'confirm_payment',
            jsonb_build_object('already_done', true, 'status', 'confirmed_received')
        );
        RETURN;
    END IF;

    IF v_payment.status <> 'reported_sent' THEN
        RAISE EXCEPTION 'Payment can only be confirmed when status is reported_sent (current: %).', v_payment.status;
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = v_payment.agreement_id;

    UPDATE public.payments
    SET status = 'confirmed_received',
        confirmed_at = now(),
        disputed_at = NULL,
        dispute_reason = NULL,
        updated_at = now()
    WHERE id = p_payment_id;

    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'payment_confirmed',
        v_caller_id,
        p_payment_id,
        'payments',
        jsonb_build_object('agreement_id', v_payment.agreement_id, 'amount', v_payment.amount)
    );

    IF v_agreement IS NOT NULL AND v_agreement.client_id IS NOT NULL THEN
        PERFORM public.notify(
            v_agreement.client_id,
            'payment_confirmed',
            'Payment Confirmed',
            'Freelancer confirmed receipt of external payment (₱' || (v_payment.amount / 100)::text || ').',
            'agreement',
            v_payment.agreement_id,
            jsonb_build_object(
                'payment_id', p_payment_id,
                'dedupe_key', 'payment_confirmed:' || p_payment_id::text
            )
        );
    END IF;

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'confirm_payment',
        jsonb_build_object('already_done', false, 'status', 'confirmed_received')
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_payment(
    p_payment_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public.confirm_payment(p_payment_id, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_payment(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_payment(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_payment(UUID) TO authenticated;

-- 3.8 dispute_payment
CREATE OR REPLACE FUNCTION public.dispute_payment(
    p_payment_id UUID,
    p_reason TEXT,
    p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_payment RECORD;
    v_agreement RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_reason IS NULL OR char_length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'A clear reason of at least 5 characters is required to dispute a payment.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found THEN
        RETURN;
    END IF;

    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found.';
    END IF;

    IF v_payment.payee_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the payee freelancer can dispute payment reports.';
    END IF;

    IF v_payment.status = 'disputed' THEN
        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'dispute_payment',
            jsonb_build_object('already_done', true, 'status', 'disputed')
        );
        RETURN;
    END IF;

    IF v_payment.status <> 'reported_sent' THEN
        RAISE EXCEPTION 'Cannot dispute a payment that was already confirmed.';
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = v_payment.agreement_id
    FOR UPDATE;

    UPDATE public.payments
    SET status = 'disputed',
        dispute_reason = trim(p_reason),
        disputed_at = now(),
        updated_at = now()
    WHERE id = p_payment_id;

    IF v_agreement IS NOT NULL THEN
        UPDATE public.agreements
        SET status = 'disputed',
            updated_at = now()
        WHERE id = v_agreement.id;
    END IF;

    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'payment_disputed',
        v_caller_id,
        p_payment_id,
        'payments',
        jsonb_build_object('agreement_id', v_payment.agreement_id, 'reason', trim(p_reason))
    );

    IF v_agreement IS NOT NULL AND v_agreement.client_id IS NOT NULL THEN
        PERFORM public.notify(
            v_agreement.client_id,
            'payment_disputed',
            'Payment Disputed',
            'Freelancer disputed payment: ' || trim(p_reason),
            'agreement',
            v_payment.agreement_id,
            jsonb_build_object(
                'payment_id', p_payment_id,
                'dedupe_key', 'payment_disputed:' || p_payment_id::text
            )
        );
    END IF;

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'dispute_payment',
        jsonb_build_object('already_done', false, 'status', 'disputed')
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.dispute_payment(
    p_payment_id UUID,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public.dispute_payment(p_payment_id, p_reason, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dispute_payment(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispute_payment(UUID, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dispute_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispute_payment(UUID, TEXT) TO authenticated;

-- 3.9 complete_agreement
CREATE OR REPLACE FUNCTION public.complete_agreement(
    p_agreement_id UUID,
    p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_agreement RECORD;
    v_milestone_count INTEGER;
    v_unapproved_count INTEGER;
    v_has_disputes BOOLEAN;
    v_has_pending_reports BOOLEAN;
    v_total_confirmed INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found THEN
        RETURN;
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_agreement.client_id <> v_caller_id AND v_agreement.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only agreement participants can complete the agreement.';
    END IF;

    IF v_agreement.status = 'completed' THEN
        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'complete_agreement',
            jsonb_build_object('already_done', true, 'status', 'completed')
        );
        RETURN;
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Only active agreements can be completed.';
    END IF;

    SELECT count(*), count(*) FILTER (WHERE status <> 'approved')
    INTO v_milestone_count, v_unapproved_count
    FROM public.milestones
    WHERE agreement_id = p_agreement_id;

    IF v_milestone_count = 0 THEN
        RAISE EXCEPTION 'Cannot complete agreement before milestones are defined and approved.';
    END IF;

    IF v_unapproved_count > 0 THEN
        RAISE EXCEPTION 'Cannot complete agreement: % milestone(s) are not yet approved.', v_unapproved_count;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.payments
        WHERE agreement_id = p_agreement_id AND status = 'disputed'
    ) INTO v_has_disputes;

    IF v_has_disputes THEN
        RAISE EXCEPTION 'Cannot complete agreement while payment disputes are unresolved.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.payments
        WHERE agreement_id = p_agreement_id AND status = 'reported_sent'
    ) INTO v_has_pending_reports;

    IF v_has_pending_reports THEN
        RAISE EXCEPTION 'Cannot complete agreement while payment reports are awaiting freelancer confirmation.';
    END IF;

    SELECT coalesce(sum(amount), 0)
    INTO v_total_confirmed
    FROM public.payments
    WHERE agreement_id = p_agreement_id AND status = 'confirmed_received';

    IF v_total_confirmed < v_agreement.agreed_price THEN
        RAISE EXCEPTION 'Cannot complete agreement: Confirmed payments (%) is less than agreed price (%).',
            v_total_confirmed, v_agreement.agreed_price;
    END IF;

    UPDATE public.agreements
    SET status = 'completed',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    WHERE id = p_agreement_id;

    UPDATE public.gigs
    SET status = 'completed',
        updated_at = now()
    WHERE id = v_agreement.gig_id;

    UPDATE public.profiles
    SET freelancer_completed_gigs = freelancer_completed_gigs + 1,
        updated_at = now()
    WHERE id = v_agreement.freelancer_id;

    UPDATE public.profiles
    SET client_completed_gigs = client_completed_gigs + 1,
        updated_at = now()
    WHERE id = v_agreement.client_id;

    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'agreement_completed',
        v_caller_id,
        p_agreement_id,
        'agreements',
        jsonb_build_object(
            'gig_id', v_agreement.gig_id,
            'client_id', v_agreement.client_id,
            'freelancer_id', v_agreement.freelancer_id,
            'total_confirmed_payments', v_total_confirmed
        )
    );

    PERFORM public.notify(
        v_agreement.client_id,
        'agreement_completed',
        'Agreement Completed',
        'Agreement for gig has been successfully completed! You may now submit a review within 14 days.',
        'agreement',
        p_agreement_id,
        jsonb_build_object('dedupe_key', 'agreement_completed:' || p_agreement_id::text)
    );

    PERFORM public.notify(
        v_agreement.freelancer_id,
        'agreement_completed',
        'Agreement Completed',
        'Agreement for gig has been successfully completed! You may now submit a review within 14 days.',
        'agreement',
        p_agreement_id,
        jsonb_build_object('dedupe_key', 'agreement_completed:' || p_agreement_id::text)
    );

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'complete_agreement',
        jsonb_build_object('already_done', false, 'status', 'completed')
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_agreement(
    p_agreement_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public.complete_agreement(p_agreement_id, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_agreement(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_agreement(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_agreement(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_agreement(UUID) TO authenticated;

-- 3.10 cancel_agreement
CREATE OR REPLACE FUNCTION public.cancel_agreement(
    p_agreement_id UUID,
    p_reason TEXT,
    p_request_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_agreement RECORD;
    v_gig RECORD;
    v_other_party_id UUID;
    v_has_submitted_work BOOLEAN;
    v_result_status TEXT;
    v_report_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_reason IS NULL OR char_length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Please provide a reason of at least 5 characters for cancelling this agreement.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found AND v_idem_result IS NOT NULL AND (v_idem_result ? 'status') THEN
        RETURN v_idem_result->>'status';
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_agreement.client_id <> v_caller_id AND v_agreement.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only agreement participants can initiate cancellation.';
    END IF;

    IF v_agreement.status IN ('cancelled', 'disputed') THEN
        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'cancel_agreement',
            jsonb_build_object('already_done', true, 'status', v_agreement.status)
        );
        RETURN v_agreement.status;
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Only active agreements can be cancelled or disputed (current: %).', v_agreement.status;
    END IF;

    IF v_agreement.client_id = v_caller_id THEN
        v_other_party_id := v_agreement.freelancer_id;
    ELSE
        v_other_party_id := v_agreement.client_id;
    END IF;

    SELECT * INTO v_gig
    FROM public.gigs
    WHERE id = v_agreement.gig_id;

    SELECT EXISTS (
        SELECT 1 FROM public.milestones
        WHERE agreement_id = p_agreement_id
          AND status IN ('submitted', 'approved', 'revision_requested')
    ) INTO v_has_submitted_work;

    IF NOT v_has_submitted_work THEN
        UPDATE public.agreements
        SET status = 'cancelled',
            updated_at = now()
        WHERE id = p_agreement_id;

        UPDATE public.gigs
        SET status = 'cancelled',
            updated_at = now()
        WHERE id = v_agreement.gig_id;

        v_result_status := 'cancelled';

        INSERT INTO public.audit_events (
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata
        ) VALUES (
            v_caller_id,
            'agreement_cancelled_freely',
            'agreements',
            p_agreement_id,
            jsonb_build_object('reason', trim(p_reason))
        );

        PERFORM public.notify(
            v_other_party_id,
            'agreement_cancelled',
            'Agreement Cancelled',
            'The agreement for "' || coalesce(v_gig.title, 'gig') || '" has been cancelled. Reason: ' || trim(p_reason),
            'agreement',
            p_agreement_id,
            jsonb_build_object('reason', trim(p_reason), 'dedupe_key', 'agreement_cancelled:' || p_agreement_id::text)
        );
    ELSE
        UPDATE public.agreements
        SET status = 'disputed',
            updated_at = now()
        WHERE id = p_agreement_id;

        INSERT INTO public.reports (
            reporter_id,
            target_type,
            target_id,
            reason_category,
            details
        ) VALUES (
            v_caller_id,
            'agreement',
            p_agreement_id,
            'cancellation_request',
            'Agreement cancellation requested after deliverables started: ' || trim(p_reason)
        )
        RETURNING id INTO v_report_id;

        v_result_status := 'disputed';

        INSERT INTO public.audit_events (
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata
        ) VALUES (
            v_caller_id,
            'agreement_cancelled_disputed',
            'agreements',
            p_agreement_id,
            jsonb_build_object('reason', trim(p_reason), 'report_id', v_report_id)
        );

        PERFORM public.notify(
            v_other_party_id,
            'agreement_disputed',
            'Agreement Cancellation Disputed',
            'A cancellation request was filed after work started. A dispute report has been opened for moderation review.',
            'agreement',
            p_agreement_id,
            jsonb_build_object('reason', trim(p_reason), 'report_id', v_report_id, 'dedupe_key', 'agreement_disputed:' || p_agreement_id::text)
        );
    END IF;

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'cancel_agreement',
        jsonb_build_object('already_done', false, 'status', v_result_status)
    );

    RETURN v_result_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_agreement(
    p_agreement_id UUID,
    p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.cancel_agreement(p_agreement_id, p_reason, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_agreement(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_agreement(UUID, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_agreement(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_agreement(UUID, TEXT) TO authenticated;

-- 3.11 publish_gig
CREATE OR REPLACE FUNCTION public.publish_gig(
    p_gig_id UUID,
    p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_profile RECORD;
    v_gig RECORD;
    v_email_confirmed BOOLEAN;
    v_category_valid BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_user_id, p_request_id);
    IF v_idem_found THEN
        RETURN;
    END IF;

    SELECT * INTO v_gig
    FROM public.gigs
    WHERE id = p_gig_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gig not found.';
    END IF;

    IF v_gig.client_id <> v_user_id THEN
        RAISE EXCEPTION 'Only the gig owner can publish this gig.';
    END IF;

    IF v_gig.status = 'open' THEN
        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'publish_gig',
            jsonb_build_object('already_done', true, 'status', 'open')
        );
        RETURN;
    END IF;

    IF v_gig.status <> 'draft' THEN
        RAISE EXCEPTION 'Only draft gigs can be published.';
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id
    FOR UPDATE;

    IF v_profile.active_mode <> 'hire' THEN
        RAISE EXCEPTION 'You must be in Hire Someone mode to publish a gig.';
    END IF;

    IF v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Your account is not active.';
    END IF;

    IF v_profile.display_name IS NULL OR trim(v_profile.display_name) = '' THEN
        RAISE EXCEPTION 'You must set a display name before publishing a gig.';
    END IF;

    SELECT (email_confirmed_at IS NOT NULL) INTO v_email_confirmed
    FROM auth.users
    WHERE id = v_user_id;

    IF v_email_confirmed IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'You must confirm your email address before publishing a gig.';
    END IF;

    IF char_length(trim(v_gig.title)) < 5 OR char_length(trim(v_gig.title)) > 80 THEN
        RAISE EXCEPTION 'Gig title must be between 5 and 80 characters.';
    END IF;

    IF char_length(trim(v_gig.description)) < 30 OR char_length(trim(v_gig.description)) > 2000 THEN
        RAISE EXCEPTION 'Gig description must be between 30 and 2000 characters.';
    END IF;

    IF v_gig.price_min < 10000 THEN
        RAISE EXCEPTION 'Minimum budget must be at least ₱100.00 (10000 centavos).';
    END IF;

    IF v_gig.price_max < v_gig.price_min THEN
        RAISE EXCEPTION 'Maximum budget cannot be less than minimum budget.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.categories
        WHERE id = v_gig.category_id AND is_active = true
    ) INTO v_category_valid;

    IF NOT v_category_valid THEN
        RAISE EXCEPTION 'Invalid or inactive category.';
    END IF;

    IF v_gig.application_deadline <= now() THEN
        RAISE EXCEPTION 'Application deadline must be in the future.';
    END IF;

    IF v_gig.deadline < v_gig.application_deadline THEN
        RAISE EXCEPTION 'Project completion deadline must be on or after the application deadline.';
    END IF;

    UPDATE public.gigs
    SET status = 'open',
        updated_at = now()
    WHERE id = p_gig_id;

    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_user_id, 'publish_gig', 'gigs', p_gig_id, jsonb_build_object('title', v_gig.title));

    PERFORM public.store_idempotency_result(
        v_user_id,
        p_request_id,
        'publish_gig',
        jsonb_build_object('already_done', false, 'status', 'open')
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_gig(p_gig_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public.publish_gig(p_gig_id, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_gig(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_gig(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_gig(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_gig(UUID) TO authenticated;

-- 3.12 cancel_gig
CREATE OR REPLACE FUNCTION public.cancel_gig(
    p_gig_id UUID,
    p_reason TEXT,
    p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_gig RECORD;
    v_applicant RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_reason IS NULL OR char_length(trim(p_reason)) < 3 OR char_length(trim(p_reason)) > 500 THEN
        RAISE EXCEPTION 'Cancellation reason must be between 3 and 500 characters.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_user_id, p_request_id);
    IF v_idem_found THEN
        RETURN;
    END IF;

    SELECT * INTO v_gig
    FROM public.gigs
    WHERE id = p_gig_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gig not found.';
    END IF;

    IF v_gig.client_id <> v_user_id THEN
        RAISE EXCEPTION 'Only the gig owner can cancel this gig.';
    END IF;

    IF v_gig.status = 'cancelled' THEN
        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'cancel_gig',
            jsonb_build_object('already_done', true, 'status', 'cancelled')
        );
        RETURN;
    END IF;

    IF v_gig.status NOT IN ('draft', 'open') THEN
        RAISE EXCEPTION 'Only draft or open gigs can be cancelled. Active gigs with agreements must use cancel_agreement.';
    END IF;

    UPDATE public.gigs
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = p_gig_id;

    IF v_gig.status = 'open' THEN
        FOR v_applicant IN
            SELECT id, freelancer_id
            FROM public.applications
            WHERE gig_id = p_gig_id AND status IN ('applied', 'countered')
        LOOP
            UPDATE public.applications
            SET status = 'declined',
                updated_at = now()
            WHERE id = v_applicant.id;

            PERFORM public.notify(
                v_applicant.freelancer_id,
                'gig_cancelled',
                'Gig Cancelled',
                'The gig "' || v_gig.title || '" has been cancelled by the client. Reason: ' || trim(p_reason),
                'gig',
                p_gig_id,
                jsonb_build_object('gig_id', p_gig_id, 'reason', trim(p_reason), 'dedupe_key', 'gig_cancelled:' || p_gig_id::text)
            );
        END LOOP;
    END IF;

    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
        v_user_id,
        'cancel_gig',
        'gigs',
        p_gig_id,
        jsonb_build_object('title', v_gig.title, 'reason', trim(p_reason))
    );

    PERFORM public.store_idempotency_result(
        v_user_id,
        p_request_id,
        'cancel_gig',
        jsonb_build_object('already_done', false, 'status', 'cancelled')
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_gig(
    p_gig_id UUID,
    p_reason TEXT DEFAULT 'Cancelled by client'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public.cancel_gig(p_gig_id, p_reason, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_gig(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_gig(UUID, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_gig(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_gig(UUID, TEXT) TO authenticated;

-- 3.13 submit_review
CREATE OR REPLACE FUNCTION public.submit_review(
    p_agreement_id UUID,
    p_rating INTEGER,
    p_comment TEXT,
    p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_agreement RECORD;
    v_reviewer_role TEXT;
    v_reviewee_role TEXT;
    v_reviewee_id UUID;
    v_review_id UUID;
    v_new_rating_count INTEGER;
    v_new_rating_avg NUMERIC(3,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
        RAISE EXCEPTION 'Rating must be an integer between 1 and 5.';
    END IF;

    IF p_comment IS NULL OR char_length(trim(p_comment)) < 10 OR char_length(trim(p_comment)) > 1000 THEN
        RAISE EXCEPTION 'Review comment must be between 10 and 1000 characters.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found AND v_idem_result IS NOT NULL AND (v_idem_result ? 'review_id') THEN
        RETURN (v_idem_result->>'review_id')::UUID;
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_agreement.status <> 'completed' THEN
        RAISE EXCEPTION 'Reviews can only be submitted for completed agreements.';
    END IF;

    IF v_agreement.completed_at IS NOT NULL AND now() > (v_agreement.completed_at + INTERVAL '14 days') THEN
        RAISE EXCEPTION 'The 14-day review window for this agreement has expired.';
    END IF;

    IF v_agreement.client_id = v_caller_id THEN
        v_reviewer_role := 'client';
        v_reviewee_role := 'freelancer';
        v_reviewee_id := v_agreement.freelancer_id;
    ELSIF v_agreement.freelancer_id = v_caller_id THEN
        v_reviewer_role := 'freelancer';
        v_reviewee_role := 'client';
        v_reviewee_id := v_agreement.client_id;
    ELSE
        RAISE EXCEPTION 'Only agreement participants can submit a review.';
    END IF;

    -- State-machine idempotent guard: if caller already reviewed this agreement, return existing review_id
    SELECT r.id INTO v_review_id
    FROM public.reviews r
    WHERE r.agreement_id = p_agreement_id AND r.reviewer_id = v_caller_id
    LIMIT 1;

    IF v_review_id IS NOT NULL THEN
        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'submit_review',
            jsonb_build_object('already_done', true, 'review_id', v_review_id)
        );
        RETURN v_review_id;
    END IF;

    INSERT INTO public.reviews (
        agreement_id,
        reviewer_id,
        reviewee_id,
        role,
        reviewee_role,
        rating,
        comment,
        hidden
    ) VALUES (
        p_agreement_id,
        v_caller_id,
        v_reviewee_id,
        v_reviewer_role,
        v_reviewee_role,
        p_rating,
        trim(p_comment),
        false
    )
    RETURNING id INTO v_review_id;

    IF v_reviewee_role = 'freelancer' THEN
        SELECT
            count(*),
            round(avg(rating)::numeric, 2)
        INTO v_new_rating_count, v_new_rating_avg
        FROM public.reviews
        WHERE reviewee_id = v_reviewee_id AND reviewee_role = 'freelancer' AND hidden = false;

        UPDATE public.profiles
        SET freelancer_rating_avg = coalesce(v_new_rating_avg, 0.00),
            freelancer_rating_count = v_new_rating_count,
            updated_at = now()
        WHERE id = v_reviewee_id;
    ELSE
        SELECT
            count(*),
            round(avg(rating)::numeric, 2)
        INTO v_new_rating_count, v_new_rating_avg
        FROM public.reviews
        WHERE reviewee_id = v_reviewee_id AND reviewee_role = 'client' AND hidden = false;

        UPDATE public.profiles
        SET client_rating_avg = coalesce(v_new_rating_avg, 0.00),
            client_rating_count = v_new_rating_count,
            updated_at = now()
        WHERE id = v_reviewee_id;
    END IF;

    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'review_submitted',
        v_caller_id,
        v_review_id,
        'reviews',
        jsonb_build_object(
            'agreement_id', p_agreement_id,
            'reviewee_id', v_reviewee_id,
            'rating', p_rating,
            'reviewer_role', v_reviewer_role,
            'reviewee_role', v_reviewee_role
        )
    );

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'submit_review',
        jsonb_build_object('already_done', false, 'review_id', v_review_id)
    );

    RETURN v_review_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_review(
    p_agreement_id UUID,
    p_rating INTEGER,
    p_comment TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.submit_review(p_agreement_id, p_rating, p_comment, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_review(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(UUID, INTEGER, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_review(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(UUID, INTEGER, TEXT) TO authenticated;

-- 3.14 submit_application
CREATE OR REPLACE FUNCTION public.submit_application(
    p_gig_id UUID,
    p_proposed_price INTEGER,
    p_estimated_days INTEGER,
    p_message TEXT,
    p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_profile RECORD;
    v_gig RECORD;
    v_has_skill BOOLEAN;
    v_email_confirmed BOOLEAN;
    v_recent_app_count INTEGER;
    v_app_id UUID;
    v_conv_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_proposed_price IS NULL OR p_proposed_price <= 0 THEN
        RAISE EXCEPTION 'Proposed price must be greater than zero.';
    END IF;
    IF p_estimated_days IS NULL OR p_estimated_days <= 0 THEN
        RAISE EXCEPTION 'Estimated days must be greater than zero.';
    END IF;
    IF p_message IS NULL OR trim(p_message) = '' THEN
        RAISE EXCEPTION 'Application message is required.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_user_id, p_request_id);
    IF v_idem_found AND v_idem_result IS NOT NULL AND (v_idem_result ? 'application_id') THEN
        RETURN (v_idem_result->>'application_id')::UUID;
    END IF;

    SELECT * INTO v_gig
    FROM public.gigs
    WHERE id = p_gig_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gig not found.';
    END IF;

    IF v_gig.client_id = v_user_id THEN
        RAISE EXCEPTION 'You cannot apply to your own gig.';
    END IF;

    -- State-machine idempotent guard: if active application already exists for (gig_id, freelancer_id), return it
    SELECT a.id INTO v_app_id
    FROM public.applications a
    WHERE a.gig_id = p_gig_id
      AND a.freelancer_id = v_user_id
      AND a.status IN ('applied', 'countered', 'accepted')
    LIMIT 1;

    IF v_app_id IS NOT NULL THEN
        PERFORM public.store_idempotency_result(
            v_user_id,
            p_request_id,
            'submit_application',
            jsonb_build_object('already_done', true, 'application_id', v_app_id)
        );
        RETURN v_app_id;
    END IF;

    SELECT count(*) INTO v_recent_app_count
    FROM public.rate_limit_events
    WHERE user_id = v_user_id
      AND action = 'submit_application'
      AND created_at > (now() - interval '1 hour');

    IF v_recent_app_count >= 10 THEN
        RAISE EXCEPTION 'Application rate limit reached. Please wait before submitting more applications.';
    END IF;

    IF v_gig.status <> 'open' THEN
        RAISE EXCEPTION 'Gig is not open for applications.';
    END IF;

    IF v_gig.application_deadline <= now() THEN
        RAISE EXCEPTION 'The application deadline for this gig has passed.';
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id;

    IF v_profile.active_mode <> 'find_work' THEN
        RAISE EXCEPTION 'You must be in Find Work mode to apply for gigs.';
    END IF;

    IF v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Your account is not active.';
    END IF;

    IF v_profile.avatar_path IS NULL OR trim(v_profile.avatar_path) = '' THEN
        RAISE EXCEPTION 'You must upload a profile photo before applying for gigs.';
    END IF;

    SELECT email_confirmed_at IS NOT NULL INTO v_email_confirmed
    FROM auth.users
    WHERE id = v_user_id;

    IF NOT coalesce(v_email_confirmed, false) THEN
        RAISE EXCEPTION 'You must confirm your email before applying for gigs.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.profile_skills WHERE profile_id = v_user_id
    ) INTO v_has_skill;

    IF NOT v_has_skill THEN
        RAISE EXCEPTION 'You must have at least one skill added to your profile before applying.';
    END IF;

    INSERT INTO public.applications (
        gig_id,
        freelancer_id,
        proposed_price,
        estimated_days,
        message
    ) VALUES (
        p_gig_id,
        v_user_id,
        p_proposed_price,
        p_estimated_days,
        trim(p_message)
    )
    RETURNING id INTO v_app_id;

    INSERT INTO public.conversations (
        application_id,
        client_id,
        freelancer_id
    ) VALUES (
        v_app_id,
        v_gig.client_id,
        v_user_id
    )
    ON CONFLICT (application_id) DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NOT NULL THEN
        INSERT INTO public.messages (
            conversation_id,
            sender_id,
            content
        ) VALUES (
            v_conv_id,
            v_user_id,
            trim(p_message)
        );
    END IF;

    INSERT INTO public.rate_limit_events (user_id, action)
    VALUES (v_user_id, 'submit_application');

    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
        v_user_id,
        'submit_application',
        'applications',
        v_app_id,
        jsonb_build_object('gig_id', p_gig_id, 'proposed_price', p_proposed_price)
    );

    PERFORM public.notify(
        v_gig.client_id,
        'application_received',
        'New Application Received',
        coalesce(v_profile.display_name, 'A freelancer') || ' applied to your gig "' || v_gig.title || '".',
        'application',
        v_app_id,
        jsonb_build_object('gig_id', p_gig_id, 'dedupe_key', 'application_received:' || v_app_id::text)
    );

    PERFORM public.store_idempotency_result(
        v_user_id,
        p_request_id,
        'submit_application',
        jsonb_build_object('already_done', false, 'application_id', v_app_id)
    );

    RETURN v_app_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_application(
    p_gig_id UUID,
    p_proposed_price INTEGER,
    p_estimated_days INTEGER,
    p_message TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.submit_application(p_gig_id, p_proposed_price, p_estimated_days, p_message, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_application(UUID, INTEGER, INTEGER, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_application(UUID, INTEGER, INTEGER, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_application(UUID, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_application(UUID, INTEGER, INTEGER, TEXT) TO authenticated;

-- 3.15 send_message
CREATE OR REPLACE FUNCTION public.send_message(
    p_conversation_id UUID,
    p_content TEXT,
    p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_conv RECORD;
    v_recipient_id UUID;
    v_sender_profile RECORD;
    v_recent_count INTEGER;
    v_msg_id UUID;
    v_preview TEXT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_caller_id, p_request_id);
    IF v_idem_found AND v_idem_result IS NOT NULL AND (v_idem_result ? 'message_id') THEN
        RETURN (v_idem_result->>'message_id')::UUID;
    END IF;

    SELECT * INTO v_sender_profile
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_sender_profile.status = 'suspended' THEN
        RAISE EXCEPTION 'Suspended accounts cannot send messages.';
    END IF;

    IF p_content IS NULL OR char_length(trim(p_content)) < 1 OR char_length(trim(p_content)) > 2000 THEN
        RAISE EXCEPTION 'Message must be between 1 and 2000 characters.';
    END IF;

    SELECT * INTO v_conv
    FROM public.conversations
    WHERE id = p_conversation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conversation not found.';
    END IF;

    IF v_conv.client_id <> v_caller_id AND v_conv.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only conversation participants can send messages.';
    END IF;

    IF v_conv.client_id = v_caller_id THEN
        v_recipient_id := v_conv.freelancer_id;
    ELSE
        v_recipient_id := v_conv.client_id;
    END IF;

    IF v_recipient_id = v_caller_id THEN
        RAISE EXCEPTION 'Cannot converse with yourself.';
    END IF;

    -- Guard against two-device / rapid double-tap identical message within 2 seconds
    SELECT m.id INTO v_msg_id
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.sender_id = v_caller_id
      AND m.content = trim(p_content)
      AND m.created_at > (now() - interval '2 seconds')
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF v_msg_id IS NOT NULL THEN
        PERFORM public.store_idempotency_result(
            v_caller_id,
            p_request_id,
            'send_message',
            jsonb_build_object('already_done', true, 'message_id', v_msg_id)
        );
        RETURN v_msg_id;
    END IF;

    SELECT count(*) INTO v_recent_count
    FROM public.messages
    WHERE sender_id = v_caller_id
      AND created_at > (now() - interval '1 minute');

    IF v_recent_count >= 30 THEN
        RAISE EXCEPTION 'Message rate limit exceeded (max 30 messages per minute).';
    END IF;

    INSERT INTO public.messages (
        conversation_id,
        sender_id,
        content
    ) VALUES (
        p_conversation_id,
        v_caller_id,
        trim(p_content)
    )
    RETURNING id INTO v_msg_id;

    UPDATE public.conversations
    SET updated_at = now()
    WHERE id = p_conversation_id;

    INSERT INTO public.conversation_reads (conversation_id, user_id, last_read_at)
    VALUES (p_conversation_id, v_caller_id, now())
    ON CONFLICT (conversation_id, user_id)
    DO UPDATE SET last_read_at = now();

    v_preview := substring(trim(p_content) from 1 for 100);
    IF char_length(trim(p_content)) > 100 THEN
        v_preview := v_preview || '...';
    END IF;

    PERFORM public.notify(
        v_recipient_id,
        'new_message',
        'New Message from ' || coalesce(v_sender_profile.display_name, 'User'),
        v_preview,
        'conversation',
        p_conversation_id,
        jsonb_build_object(
            'conversation_id', p_conversation_id,
            'sender_id', v_caller_id,
            'message_id', v_msg_id
        )
    );

    PERFORM public.store_idempotency_result(
        v_caller_id,
        p_request_id,
        'send_message',
        jsonb_build_object('already_done', false, 'message_id', v_msg_id)
    );

    RETURN v_msg_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_message(
    p_conversation_id UUID,
    p_content TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.send_message(p_conversation_id, p_content, NULL::UUID);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_message(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(UUID, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.send_message(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(UUID, TEXT) TO authenticated;
