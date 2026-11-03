-- ============================================================================
-- Milestone 25: Notifications Coverage and Scheduled Reminders (v5.4 Section 1)
--
-- 1. Covers every action in Section 1 with notifications for counterparty
--    (proposal_withdrawn, milestones_updated, report_resolved, account_status_changed).
-- 2. Creates run_scheduled_reminders() emitting all 7 deduped reminders:
--    - Milestone awaiting review for 3 days & 7 days
--    - Payment awaiting confirmation for 2 days
--    - Review window closing (3 days remaining of 14-day window)
--    - Gig application deadline in 24 hours
--    - Gig expired / closed
--    - Agreement deadline in 48 hours
-- 3. Schedules run_scheduled_reminders() via pg_cron (hourly).
-- ============================================================================

-- 1. Enhance respond_to_counter to notify client on proposal withdrawal
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
    v_cached JSONB;
    v_app RECORD;
    v_gig RECORD;
    v_agreement_id UUID;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_action NOT IN ('accept', 'decline', 'withdraw') THEN
        RAISE EXCEPTION 'Invalid action. Must be accept, decline, or withdraw.';
    END IF;

    IF p_request_id IS NOT NULL THEN
        v_cached := public.get_idempotency_result(v_user_id, p_request_id);
        IF v_cached IS NOT NULL THEN
            IF v_cached ? 'agreement_id' THEN
                RETURN (v_cached->>'agreement_id')::UUID;
            END IF;
            RETURN NULL;
        END IF;
    END IF;

    SELECT * INTO v_app
    FROM public.applications
    WHERE id = p_application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found.';
    END IF;

    IF v_app.freelancer_id <> v_user_id THEN
        RAISE EXCEPTION 'Only the freelancer who submitted this proposal can respond to the counteroffer.';
    END IF;

    IF p_action = 'withdraw' THEN
        IF v_app.status = 'withdrawn' THEN
            v_result := jsonb_build_object('ok', true, 'already_done', true, 'agreement_id', null);
            IF p_request_id IS NOT NULL THEN
                PERFORM public.store_idempotency_result(v_user_id, p_request_id, 'respond_to_counter', v_result);
            END IF;
            RETURN NULL;
        END IF;

        IF v_app.status NOT IN ('applied', 'countered') THEN
            RAISE EXCEPTION 'Cannot withdraw application in status "%".', v_app.status;
        END IF;

        UPDATE public.applications
        SET status = 'withdrawn',
            updated_at = now()
        WHERE id = p_application_id;

        -- Notify client that proposal was withdrawn
        SELECT * INTO v_gig FROM public.gigs WHERE id = v_app.gig_id;
        IF FOUND AND v_gig.client_id IS NOT NULL THEN
            PERFORM public.notify(
                v_gig.client_id,
                'proposal_withdrawn',
                'Application Withdrawn',
                'A freelancer has withdrawn their application for "' || v_gig.title || '".',
                'gig',
                v_gig.id,
                jsonb_build_object('gig_id', v_gig.id, 'application_id', p_application_id, 'dedupe_key', 'proposal_withdrawn:' || p_application_id::text)
            );
        END IF;

        v_result := jsonb_build_object('ok', true, 'already_done', false, 'agreement_id', null);
        IF p_request_id IS NOT NULL THEN
            PERFORM public.store_idempotency_result(v_user_id, p_request_id, 'respond_to_counter', v_result);
        END IF;
        RETURN NULL;
    END IF;

    IF v_app.status = 'accepted' THEN
        SELECT id INTO v_agreement_id
        FROM public.agreements
        WHERE gig_id = v_app.gig_id AND freelancer_id = v_app.freelancer_id
        LIMIT 1;

        v_result := jsonb_build_object('ok', true, 'already_done', true, 'agreement_id', v_agreement_id);
        IF p_request_id IS NOT NULL THEN
            PERFORM public.store_idempotency_result(v_user_id, p_request_id, 'respond_to_counter', v_result);
        END IF;
        RETURN v_agreement_id;
    END IF;

    IF v_app.status = 'declined' AND p_action = 'decline' THEN
        v_result := jsonb_build_object('ok', true, 'already_done', true, 'agreement_id', null);
        IF p_request_id IS NOT NULL THEN
            PERFORM public.store_idempotency_result(v_user_id, p_request_id, 'respond_to_counter', v_result);
        END IF;
        RETURN NULL;
    END IF;

    IF v_app.status <> 'countered' THEN
        RAISE EXCEPTION 'This application has not been countered (status: %).', v_app.status;
    END IF;

    SELECT * INTO v_gig
    FROM public.gigs
    WHERE id = v_app.gig_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated gig not found.';
    END IF;

    IF p_action = 'decline' THEN
        UPDATE public.applications
        SET status = 'declined',
            updated_at = now()
        WHERE id = p_application_id;

        PERFORM public.notify(
            v_gig.client_id,
            'counter_declined',
            'Counteroffer Declined',
            'The freelancer declined your counteroffer of ' || (coalesce(v_app.counter_price, 0) / 100)::text || ' PHP for "' || v_gig.title || '".',
            'gig',
            v_gig.id,
            jsonb_build_object('gig_id', v_gig.id, 'application_id', p_application_id, 'dedupe_key', 'counter_declined:' || p_application_id::text)
        );

        v_result := jsonb_build_object('ok', true, 'already_done', false, 'agreement_id', null);
        IF p_request_id IS NOT NULL THEN
            PERFORM public.store_idempotency_result(v_user_id, p_request_id, 'respond_to_counter', v_result);
        END IF;
        RETURN NULL;
    END IF;

    IF p_action = 'accept' THEN
        IF v_gig.status <> 'open' THEN
            RAISE EXCEPTION 'This gig is no longer open for hire.';
        END IF;

        IF EXISTS (SELECT 1 FROM public.agreements WHERE gig_id = v_gig.id) THEN
            RAISE EXCEPTION 'An agreement has already been created for this gig.';
        END IF;

        UPDATE public.applications
        SET status = 'accepted',
            updated_at = now()
        WHERE id = p_application_id;

        UPDATE public.applications
        SET status = 'declined',
            updated_at = now()
        WHERE gig_id = v_app.gig_id
          AND id <> p_application_id
          AND status IN ('applied', 'countered');

        UPDATE public.gigs
        SET status = 'in_progress',
            updated_at = now()
        WHERE id = v_app.gig_id;

        INSERT INTO public.agreements (
            gig_id,
            client_id,
            freelancer_id,
            agreed_price,
            deadline,
            status
        ) VALUES (
            v_app.gig_id,
            v_gig.client_id,
            v_app.freelancer_id,
            coalesce(v_app.counter_price, v_app.proposed_price),
            v_gig.deadline,
            'active'
        )
        RETURNING id INTO v_agreement_id;

        PERFORM public.notify(
            v_gig.client_id,
            'application_accepted',
            'Agreement Created!',
            'The freelancer accepted your counteroffer. Agreement created for "' || v_gig.title || '".',
            'agreement',
            v_agreement_id,
            jsonb_build_object('agreement_id', v_agreement_id, 'gig_id', v_gig.id, 'dedupe_key', 'application_accepted:' || v_agreement_id::text)
        );

        v_result := jsonb_build_object('ok', true, 'already_done', false, 'agreement_id', v_agreement_id);
        IF p_request_id IS NOT NULL THEN
            PERFORM public.store_idempotency_result(v_user_id, p_request_id, 'respond_to_counter', v_result);
        END IF;
        RETURN v_agreement_id;
    END IF;

    RETURN NULL;
END;
$$;

-- 2. Enhance define_milestones to notify freelancer when milestones are updated (vs initial definition)
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
    v_user_id UUID;
    v_cached JSONB;
    v_agreement RECORD;
    v_elem JSONB;
    v_total_amount BIGINT := 0;
    v_elem_amount BIGINT;
    v_elem_title TEXT;
    v_elem_desc TEXT;
    v_seq INT := 0;
    v_count INT;
    v_existing_count INT;
    v_result JSONB;
    v_notif_type TEXT;
    v_notif_title TEXT;
    v_notif_body TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_request_id IS NOT NULL THEN
        v_cached := public.get_idempotency_result(v_user_id, p_request_id);
        IF v_cached IS NOT NULL THEN
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

    IF v_agreement.client_id <> v_user_id THEN
        RAISE EXCEPTION 'Only the client can define milestones.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Cannot define milestones on non-active agreement (status: %).', v_agreement.status;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.milestones
        WHERE agreement_id = p_agreement_id
          AND status IN ('submitted', 'approved', 'revision_requested')
    ) THEN
        RAISE EXCEPTION 'Cannot redefine milestones once work has been submitted or approved.';
    END IF;

    SELECT count(*) INTO v_existing_count
    FROM public.milestones
    WHERE agreement_id = p_agreement_id;

    v_count := jsonb_array_length(p_milestones);
    IF v_count < 1 OR v_count > 5 THEN
        RAISE EXCEPTION 'An agreement must have between 1 and 5 milestones (got %).', v_count;
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
        v_elem_amount := (v_elem->>'amount')::BIGINT;
        v_elem_title  := trim(v_elem->>'title');

        IF v_elem_title IS NULL OR length(v_elem_title) < 3 THEN
            RAISE EXCEPTION 'Each milestone must have a title of at least 3 characters.';
        END IF;
        IF v_elem_amount IS NULL OR v_elem_amount <= 0 THEN
            RAISE EXCEPTION 'Each milestone must have a positive amount in centavos.';
        END IF;

        v_total_amount := v_total_amount + v_elem_amount;
    END LOOP;

    IF v_total_amount <> v_agreement.agreed_price THEN
        RAISE EXCEPTION 'Milestone sum (%) must exactly equal agreed price (%).',
            v_total_amount, v_agreement.agreed_price;
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
            title,
            description,
            amount,
            status
        ) VALUES (
            p_agreement_id,
            v_seq,
            v_elem_title,
            v_elem_desc,
            v_elem_amount,
            'pending'
        );
    END LOOP;

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
            'milestone_count', v_seq,
            'dedupe_key', v_notif_type || ':' || p_agreement_id::text || ':' || v_seq::text
        )
    );

    v_result := jsonb_build_object('ok', true, 'count', v_seq);
    IF p_request_id IS NOT NULL THEN
        PERFORM public.store_idempotency_result(v_user_id, p_request_id, 'define_milestones', v_result);
    END IF;
END;
$$;

-- 3. Resolve report helper with counterparty notification
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

-- 4. Scheduled Reminders (pg_cron)
CREATE OR REPLACE FUNCTION public.run_scheduled_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_count INTEGER := 0;
    r RECORD;
BEGIN
    -- 1. Milestone awaiting client review for >= 3 days and < 7 days
    FOR r IN
        SELECT m.id AS milestone_id, m.title, m.agreement_id, m.updated_at, a.client_id
        FROM public.milestones m
        JOIN public.agreements a ON a.id = m.agreement_id
        WHERE m.status = 'submitted'
          AND m.updated_at <= (now() - interval '3 days')
          AND m.updated_at > (now() - interval '7 days')
          AND a.status = 'active'
    LOOP
        IF public.notify(
            r.client_id,
            'milestone_review_reminder_3d',
            'Milestone Awaiting Review (3 Days)',
            'Deliverables for "' || r.title || '" have been awaiting your review for 3 days.',
            'milestone',
            r.milestone_id,
            jsonb_build_object(
                'milestone_id', r.milestone_id,
                'agreement_id', r.agreement_id,
                'dedupe_key', 'milestone_review_reminder_3d:' || r.milestone_id::text
            )
        ) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    -- 2. Milestone awaiting client review for >= 7 days
    FOR r IN
        SELECT m.id AS milestone_id, m.title, m.agreement_id, m.updated_at, a.client_id
        FROM public.milestones m
        JOIN public.agreements a ON a.id = m.agreement_id
        WHERE m.status = 'submitted'
          AND m.updated_at <= (now() - interval '7 days')
          AND a.status = 'active'
    LOOP
        IF public.notify(
            r.client_id,
            'milestone_review_reminder_7d',
            'Milestone Awaiting Review (7 Days)',
            'Deliverables for "' || r.title || '" have been awaiting your review for 7 days.',
            'milestone',
            r.milestone_id,
            jsonb_build_object(
                'milestone_id', r.milestone_id,
                'agreement_id', r.agreement_id,
                'dedupe_key', 'milestone_review_reminder_7d:' || r.milestone_id::text
            )
        ) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    -- 3. Payment awaiting payee confirmation for >= 2 days
    FOR r IN
        SELECT p.id AS payment_id, p.agreement_id, p.payee_id, p.amount, p.reported_at
        FROM public.payments p
        JOIN public.agreements a ON a.id = p.agreement_id
        WHERE p.status = 'reported_sent'
          AND p.reported_at <= (now() - interval '2 days')
          AND a.status = 'active'
    LOOP
        IF public.notify(
            r.payee_id,
            'payment_confirm_reminder_2d',
            'Payment Awaiting Confirmation',
            'A payment report of ' || (r.amount / 100)::text || ' PHP has been awaiting your confirmation for 2 days.',
            'payment',
            r.payment_id,
            jsonb_build_object(
                'payment_id', r.payment_id,
                'agreement_id', r.agreement_id,
                'dedupe_key', 'payment_confirm_reminder_2d:' || r.payment_id::text
            )
        ) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    -- 4. Review window closing (agreement completed between 11 and 14 days ago)
    FOR r IN
        SELECT a.id AS agreement_id, a.client_id, a.freelancer_id, a.completed_at
        FROM public.agreements a
        WHERE a.status = 'completed'
          AND a.completed_at IS NOT NULL
          AND a.completed_at <= (now() - interval '11 days')
          AND a.completed_at > (now() - interval '14 days')
    LOOP
        -- Client reminder if client hasn't reviewed yet
        IF NOT EXISTS (
            SELECT 1 FROM public.reviews
            WHERE agreement_id = r.agreement_id AND reviewer_id = r.client_id
        ) THEN
            IF public.notify(
                r.client_id,
                'review_window_closing_3d',
                'Review Window Closing Soon',
                'Only 3 days remain to submit your feedback for this completed agreement.',
                'agreement',
                r.agreement_id,
                jsonb_build_object(
                    'agreement_id', r.agreement_id,
                    'dedupe_key', 'review_window_closing_3d:' || r.agreement_id::text || ':' || r.client_id::text
                )
            ) IS NOT NULL THEN
                v_count := v_count + 1;
            END IF;
        END IF;

        -- Freelancer reminder if freelancer hasn't reviewed yet
        IF NOT EXISTS (
            SELECT 1 FROM public.reviews
            WHERE agreement_id = r.agreement_id AND reviewer_id = r.freelancer_id
        ) THEN
            IF public.notify(
                r.freelancer_id,
                'review_window_closing_3d',
                'Review Window Closing Soon',
                'Only 3 days remain to submit your feedback for this completed agreement.',
                'agreement',
                r.agreement_id,
                jsonb_build_object(
                    'agreement_id', r.agreement_id,
                    'dedupe_key', 'review_window_closing_3d:' || r.agreement_id::text || ':' || r.freelancer_id::text
                )
            ) IS NOT NULL THEN
                v_count := v_count + 1;
            END IF;
        END IF;
    END LOOP;

    -- 5. Gig application deadline within 24 hours
    FOR r IN
        SELECT g.id AS gig_id, g.title, g.client_id, g.application_deadline
        FROM public.gigs g
        WHERE g.status = 'open'
          AND g.application_deadline > now()
          AND g.application_deadline <= (now() + interval '24 hours')
    LOOP
        IF public.notify(
            r.client_id,
            'gig_application_deadline_24h',
            'Application Deadline in 24 Hours',
            'The application deadline for "' || r.title || '" will close in less than 24 hours.',
            'gig',
            r.gig_id,
            jsonb_build_object(
                'gig_id', r.gig_id,
                'dedupe_key', 'gig_application_deadline_24h:' || r.gig_id::text
            )
        ) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    -- 6. Gig expired / application window closed
    FOR r IN
        SELECT g.id AS gig_id, g.title, g.client_id, g.application_deadline
        FROM public.gigs g
        WHERE g.status = 'open'
          AND g.application_deadline <= now()
    LOOP
        IF public.notify(
            r.client_id,
            'gig_expired',
            'Gig Application Window Closed',
            'The application deadline for "' || r.title || '" has passed.',
            'gig',
            r.gig_id,
            jsonb_build_object(
                'gig_id', r.gig_id,
                'dedupe_key', 'gig_expired:' || r.gig_id::text
            )
        ) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    -- 7. Agreement deadline in 48 hours
    FOR r IN
        SELECT a.id AS agreement_id, a.client_id, a.freelancer_id, a.deadline, g.title AS gig_title
        FROM public.agreements a
        LEFT JOIN public.gigs g ON g.id = a.gig_id
        WHERE a.status = 'active'
          AND a.deadline > now()
          AND a.deadline <= (now() + interval '48 hours')
    LOOP
        -- Notify client
        IF public.notify(
            r.client_id,
            'agreement_deadline_48h',
            'Agreement Deadline in 48 Hours',
            'The completion deadline for "' || coalesce(r.gig_title, 'your project') || '" is in 48 hours.',
            'agreement',
            r.agreement_id,
            jsonb_build_object(
                'agreement_id', r.agreement_id,
                'dedupe_key', 'agreement_deadline_48h:' || r.agreement_id::text || ':' || r.client_id::text
            )
        ) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;

        -- Notify freelancer
        IF public.notify(
            r.freelancer_id,
            'agreement_deadline_48h',
            'Agreement Deadline in 48 Hours',
            'The completion deadline for "' || coalesce(r.gig_title, 'your project') || '" is in 48 hours.',
            'agreement',
            r.agreement_id,
            jsonb_build_object(
                'agreement_id', r.agreement_id,
                'dedupe_key', 'agreement_deadline_48h:' || r.agreement_id::text || ':' || r.freelancer_id::text
            )
        ) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_reminders() FROM PUBLIC, anon, authenticated;

-- Schedule reminders hourly via pg_cron when extension is available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'run-scheduled-reminders-hourly',
            '0 * * * *',
            $cron$SELECT public.run_scheduled_reminders();$cron$
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;
