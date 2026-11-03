-- Migration: 20261011000015_real_loop.sql
-- Milestone 15: Complete Real Loop Hardening
-- Strictly adheres to docs/REAL_LOGIC_V5.md sections 0 and 8, docs/GIGORMOC_SPEC.md, and AGENTS.md

-- 1. Fix public.respond_to_counter:
--    - Correct inverted column-to-value assignments for public.agreements
--    - Enforce own-content rule (client_id <> freelancer_id)
--    - Set gig status = 'in_progress' and decline remaining proposals
--    - Emit proper notifications:
--      * When accepted: notify client (counter_accepted), notify both (agreement_created), decline others
--      * When declined / withdrawn: notify client (counter_declined)

DROP FUNCTION IF EXISTS public.respond_to_counter(uuid, text);
CREATE OR REPLACE FUNCTION public.respond_to_counter(
  p_application_id uuid,
  p_action text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_app record;
  v_gig record;
  v_agreement_id uuid;
  v_other_app record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_action NOT IN ('accept', 'decline', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid counter response. Must be accept, decline, or withdraw.';
  END IF;

  -- Lock application
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

  IF v_app.status <> 'countered' THEN
    RAISE EXCEPTION 'Application is not in countered status (current: %).', v_app.status;
  END IF;

  -- Lock gig
  SELECT * INTO v_gig
  FROM public.gigs
  WHERE id = v_app.gig_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gig not found.';
  END IF;

  IF p_action IN ('decline', 'withdraw') THEN
    UPDATE public.applications
    SET status = p_action,
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

    -- Notify client that counteroffer was declined/withdrawn
    PERFORM public.notify(
      v_gig.client_id,
      'counter_declined',
      'Counteroffer Declined',
      'Freelancer declined the counteroffer for "' || v_gig.title || '".',
      'application',
      p_application_id,
      jsonb_build_object('gig_id', v_gig.id)
    );

    RETURN NULL;

  ELSIF p_action = 'accept' THEN
    IF v_gig.status <> 'open' THEN
      RAISE EXCEPTION 'Gig is not open (current: %). An active agreement may already exist.', v_gig.status;
    END IF;

    -- Check if active agreement already exists
    IF EXISTS (
      SELECT 1 FROM public.agreements
      WHERE gig_id = v_gig.id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'An active agreement already exists for this gig.';
    END IF;

    -- Own content check: client and freelancer must be distinct
    IF v_gig.client_id = v_user_id THEN
      RAISE EXCEPTION 'Client and freelancer cannot be the same person.';
    END IF;

    UPDATE public.applications
    SET status = 'accepted',
        updated_at = now()
    WHERE id = p_application_id;

    -- Create agreement: client_id = v_gig.client_id, freelancer_id = v_user_id
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

    -- Update gig status
    UPDATE public.gigs
    SET status = 'in_progress',
        updated_at = now()
    WHERE id = v_gig.id;

    -- Decline all other pending applications for this gig
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

    -- Notify client that counter was accepted
    PERFORM public.notify(
      v_gig.client_id,
      'counter_accepted',
      'Counteroffer Accepted!',
      'Freelancer accepted your counteroffer for "' || v_gig.title || '". Agreement is now active.',
      'agreement',
      v_agreement_id,
      jsonb_build_object('gig_id', v_gig.id)
    );

    -- Notify both parties: agreement_created
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

    RETURN v_agreement_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.respond_to_counter(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_counter(uuid, text) TO authenticated;

-- 2. Update public.cancel_agreement to emit agreement_cancelled notification
DROP FUNCTION IF EXISTS public.cancel_agreement(uuid, text);
CREATE OR REPLACE FUNCTION public.cancel_agreement(
    p_agreement_id UUID,
    p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
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

    -- Lock agreement
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

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Only active agreements can be cancelled or disputed (current: %).', v_agreement.status;
    END IF;

    -- Determine the other party to notify
    IF v_agreement.client_id = v_caller_id THEN
      v_other_party_id := v_agreement.freelancer_id;
    ELSE
      v_other_party_id := v_agreement.client_id;
    END IF;

    SELECT * INTO v_gig
    FROM public.gigs
    WHERE id = v_agreement.gig_id;

    -- Check if any milestone has been submitted or approved
    SELECT EXISTS (
        SELECT 1 FROM public.milestones
        WHERE agreement_id = p_agreement_id
          AND status IN ('submitted', 'approved', 'revision_requested')
    ) INTO v_has_submitted_work;

    IF NOT v_has_submitted_work THEN
        -- Work has not started yet -> Free cancellation
        UPDATE public.agreements
        SET status = 'cancelled',
            updated_at = now()
        WHERE id = p_agreement_id;

        -- Cancel gig
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

        -- Notify the other party
        PERFORM public.notify(
          v_other_party_id,
          'agreement_cancelled',
          'Agreement Cancelled',
          'The agreement for "' || coalesce(v_gig.title, 'gig') || '" has been cancelled. Reason: ' || trim(p_reason),
          'agreement',
          p_agreement_id,
          jsonb_build_object('reason', trim(p_reason))
        );

    ELSE
        -- Work already started -> Flag as disputed and log a report for manual review
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

        -- Notify other party that cancellation was requested and dispute opened
        PERFORM public.notify(
          v_other_party_id,
          'agreement_disputed',
          'Agreement Cancellation Disputed',
          'A cancellation request was filed after work started. A dispute report has been opened for moderation review.',
          'agreement',
          p_agreement_id,
          jsonb_build_object('reason', trim(p_reason), 'report_id', v_report_id)
        );
    END IF;

    RETURN v_result_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_agreement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_agreement(uuid, text) TO authenticated;
