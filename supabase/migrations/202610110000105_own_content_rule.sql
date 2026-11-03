-- Migration: 202610110000105_own_content_rule.sql
-- Retrofit R4: Own-Content Rule Audit & Enforcement
-- Strictly adheres to AGENTS.md, docs/GIGORMOC_SPEC.md section 3B, and docs/ROLE_UX.md section 4.

-- 1. Table constraint: An agreement can never have client_id = freelancer_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_agreements_different_parties'
    ) THEN
        ALTER TABLE public.agreements
        ADD CONSTRAINT chk_agreements_different_parties
        CHECK (client_id <> freelancer_id);
    END IF;
END $$;

-- 2. Update submit_review: Explicit check rejecting self-reviews
CREATE OR REPLACE FUNCTION public.submit_review(
    p_agreement_id UUID,
    p_rating INTEGER,
    p_comment TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
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

    -- Validate input rating and comment
    IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
        RAISE EXCEPTION 'Rating must be an integer between 1 and 5.';
    END IF;

    IF p_comment IS NULL OR char_length(trim(p_comment)) < 10 OR char_length(trim(p_comment)) > 1000 THEN
        RAISE EXCEPTION 'Review comment must be between 10 and 1000 characters.';
    END IF;

    -- Lock agreement row
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

    -- 14-day window check measured strictly from completed_at
    IF v_agreement.completed_at IS NOT NULL AND now() > (v_agreement.completed_at + INTERVAL '14 days') THEN
        RAISE EXCEPTION 'The 14-day review window for this agreement has expired.';
    END IF;

    -- Check participation & determine roles
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

    -- Own-content rule: Cannot review yourself
    IF v_caller_id = v_reviewee_id THEN
        RAISE EXCEPTION 'You cannot review yourself.';
    END IF;

    -- Check if caller already reviewed this agreement
    IF EXISTS (
        SELECT 1 FROM public.reviews
        WHERE agreement_id = p_agreement_id AND reviewer_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'You have already submitted a review for this agreement.';
    END IF;

    -- Insert review
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

    -- Recalculate recipient rating strictly from non-hidden reviews
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

    -- Audit event
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
            'reviewee_role', v_reviewee_role,
            'rating', p_rating
        )
    );

    RETURN v_review_id;
END;
$$;

-- 3. Update submit_report: Reject reporting own content / self
CREATE OR REPLACE FUNCTION public.submit_report(
    p_target_type TEXT,
    p_target_id UUID,
    p_reason_category TEXT,
    p_details TEXT,
    p_evidence_path TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_recent_reports_count INTEGER;
    v_report_id UUID;
    v_owner_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_target_type NOT IN ('profile', 'gig', 'agreement', 'message') THEN
        RAISE EXCEPTION 'Invalid report target type.';
    END IF;

    IF p_reason_category NOT IN ('spam_scam', 'harassment', 'unresponsive', 'payment_issue', 'work_quality', 'cancellation_request', 'other') THEN
        RAISE EXCEPTION 'Invalid reason category.';
    END IF;

    IF p_details IS NULL OR char_length(trim(p_details)) < 10 OR char_length(trim(p_details)) > 2000 THEN
        RAISE EXCEPTION 'Report details must be between 10 and 2000 characters.';
    END IF;

    -- Own-content rule enforcement: Cannot report own profile, own gig, own message
    IF p_target_type = 'profile' THEN
        IF p_target_id = v_caller_id THEN
            RAISE EXCEPTION 'You cannot report your own profile.';
        END IF;
    ELSIF p_target_type = 'gig' THEN
        SELECT client_id INTO v_owner_id FROM public.gigs WHERE id = p_target_id;
        IF v_owner_id = v_caller_id THEN
            RAISE EXCEPTION 'You cannot report your own gig.';
        END IF;
    ELSIF p_target_type = 'message' THEN
        SELECT sender_id INTO v_owner_id FROM public.messages WHERE id = p_target_id;
        IF v_owner_id = v_caller_id THEN
            RAISE EXCEPTION 'You cannot report your own message.';
        END IF;
    END IF;

    -- Rate limit check: max 5 reports per hour
    SELECT count(*) INTO v_recent_reports_count
    FROM public.reports
    WHERE reporter_id = v_caller_id
      AND created_at > now() - INTERVAL '1 hour';

    IF v_recent_reports_count >= 5 THEN
        RAISE EXCEPTION 'Report limit reached (maximum 5 reports per hour).';
    END IF;

    INSERT INTO public.reports (
        reporter_id,
        target_type,
        target_id,
        reason_category,
        details,
        evidence_path
    ) VALUES (
        v_caller_id,
        p_target_type,
        p_target_id,
        p_reason_category,
        trim(p_details),
        p_evidence_path
    )
    RETURNING id INTO v_report_id;

    -- Record audit event
    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'report_submitted',
        v_caller_id,
        v_report_id,
        'reports',
        jsonb_build_object(
            'target_type', p_target_type,
            'target_id', p_target_id,
            'reason_category', p_reason_category
        )
    );

    RETURN v_report_id;
END;
$$;

-- 4. Database RPC: get_available_gigs (Enforces own-content exclusion in database)
-- Freelancers can never be shown their own gigs as available work
CREATE OR REPLACE FUNCTION public.get_available_gigs(
    p_category_id UUID DEFAULT NULL,
    p_work_type TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    client_id UUID,
    title TEXT,
    price_min INTEGER,
    price_max INTEGER,
    work_type TEXT,
    area TEXT,
    application_deadline TIMESTAMPTZ,
    deadline TIMESTAMPTZ,
    status TEXT,
    created_at TIMESTAMPTZ,
    category_name TEXT,
    client_display_name TEXT,
    client_rating_avg NUMERIC(3,2),
    client_rating_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
BEGIN
    v_caller_id := auth.uid();

    RETURN QUERY
    SELECT 
        g.id,
        g.client_id,
        g.title,
        g.price_min,
        g.price_max,
        g.work_type,
        g.area,
        g.application_deadline,
        g.deadline,
        g.status,
        g.created_at,
        c.name AS category_name,
        p.display_name AS client_display_name,
        p.client_rating_avg,
        p.client_rating_count
    FROM public.gigs g
    JOIN public.categories c ON c.id = g.category_id
    JOIN public.profiles p ON p.id = g.client_id
    WHERE g.status = 'open'
      AND g.application_deadline > now()
      -- Own-content rule: caller's own gigs are strictly excluded
      AND (v_caller_id IS NULL OR g.client_id <> v_caller_id)
      AND (p_category_id IS NULL OR g.category_id = p_category_id)
      AND (p_work_type IS NULL OR g.work_type = p_work_type)
      AND (
          p_search IS NULL OR
          p_search = '' OR
          g.title ILIKE '%' || p_search || '%' OR
          g.description ILIKE '%' || p_search || '%' OR
          g.area ILIKE '%' || p_search || '%'
      )
    ORDER BY g.created_at DESC;
END;
$$;

-- 5. Revoke execute on new/updated functions from anon and public, grant to authenticated
REVOKE EXECUTE ON FUNCTION public.submit_review(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(UUID, INTEGER, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_report(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_report(TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_available_gigs(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_gigs(UUID, TEXT, TEXT) TO authenticated;
