-- Fix idempotency helper record handling in protected RPC callers.
-- get_idempotency_result returns OUT (p_found, p_result), not a JSONB scalar.

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
    v_cached_found BOOLEAN := false;
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
        SELECT p_found, p_result
        INTO v_cached_found, v_cached
        FROM public.get_idempotency_result(v_user_id, p_request_id);
        IF v_cached_found THEN
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
    v_cached_found BOOLEAN := false;
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
        SELECT p_found, p_result
        INTO v_cached_found, v_cached
        FROM public.get_idempotency_result(v_user_id, p_request_id);
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

REVOKE EXECUTE ON FUNCTION public.respond_to_counter(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_counter(UUID, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB, UUID) TO authenticated;
