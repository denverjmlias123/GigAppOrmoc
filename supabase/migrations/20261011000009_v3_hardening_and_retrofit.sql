-- Migration: 20261011000009_v3_hardening_and_retrofit.sql
-- Blueprint V3 Retrofit & Hardening Fixes
-- Covers R2, R3, and Milestone 9 database hardening requirements.

-- 1. Align agreements: add completed_at
ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill completed_at for existing completed agreements
UPDATE public.agreements
SET completed_at = updated_at
WHERE status = 'completed' AND completed_at IS NULL;

-- 2. Align reviews table: add reviewee_role, hidden flag, hidden_at, hidden_by
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reviewee_role TEXT CHECK (reviewee_role IN ('freelancer', 'client')),
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hidden_by UUID REFERENCES public.profiles(id) DEFAULT NULL;

-- Backfill reviewee_role if null
UPDATE public.reviews
SET reviewee_role = CASE WHEN role = 'client' THEN 'freelancer' ELSE 'client' END
WHERE reviewee_role IS NULL;

-- Update RLS on reviews: authenticated read only non-hidden reviews; admins read all
DROP POLICY IF EXISTS "Authenticated users can read reviews" ON public.reviews;
CREATE POLICY "Authenticated users can read active reviews"
ON public.reviews FOR SELECT
TO authenticated
USING (
  hidden = false
  OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
);

-- 3. Update complete_agreement RPC function to record completed_at atomically
CREATE OR REPLACE FUNCTION public.complete_agreement(
    p_agreement_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_agreement RECORD;
    v_unapproved_count INTEGER;
    v_total_confirmed BIGINT := 0;
    v_has_disputes BOOLEAN;
    v_has_pending_reports BOOLEAN;
    v_milestone_count INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- Lock agreement
    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    -- Caller must be participant or admin
    IF v_agreement.client_id <> v_caller_id
       AND v_agreement.freelancer_id <> v_caller_id
       AND NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_caller_id)
    THEN
        RAISE EXCEPTION 'Only agreement participants can complete the agreement.';
    END IF;

    IF v_agreement.status = 'completed' THEN
        RETURN; -- idempotent
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Only active agreements can be completed.';
    END IF;

    -- Check milestones: must have at least 1 milestone, and all must be approved
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

    -- Check payment disputes
    SELECT EXISTS (
        SELECT 1 FROM public.payments
        WHERE agreement_id = p_agreement_id AND status = 'disputed'
    ) INTO v_has_disputes;

    IF v_has_disputes THEN
        RAISE EXCEPTION 'Cannot complete agreement while payment disputes are unresolved.';
    END IF;

    -- Check pending payment reports
    SELECT EXISTS (
        SELECT 1 FROM public.payments
        WHERE agreement_id = p_agreement_id AND status = 'reported_sent'
    ) INTO v_has_pending_reports;

    IF v_has_pending_reports THEN
        RAISE EXCEPTION 'Cannot complete agreement while payment reports are awaiting freelancer confirmation.';
    END IF;

    -- Check total confirmed payments vs agreed price
    SELECT coalesce(sum(amount), 0)
    INTO v_total_confirmed
    FROM public.payments
    WHERE agreement_id = p_agreement_id AND status = 'confirmed_received';

    IF v_total_confirmed < v_agreement.agreed_price THEN
        RAISE EXCEPTION 'Cannot complete agreement: Confirmed payments (%) is less than agreed price (%).',
            v_total_confirmed, v_agreement.agreed_price;
    END IF;

    -- Complete agreement with atomic completed_at timestamp
    UPDATE public.agreements
    SET status = 'completed',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    WHERE id = p_agreement_id;

    -- Update gig status to completed
    UPDATE public.gigs
    SET status = 'completed',
        updated_at = now()
    WHERE id = v_agreement.gig_id;

    -- Increment participant stats
    UPDATE public.profiles
    SET freelancer_completed_gigs = freelancer_completed_gigs + 1,
        updated_at = now()
    WHERE id = v_agreement.freelancer_id;

    UPDATE public.profiles
    SET client_completed_gigs = client_completed_gigs + 1,
        updated_at = now()
    WHERE id = v_agreement.client_id;

    -- Audit event
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
END;
$$;

-- 4. Update submit_review RPC function
-- Uses completed_at + 14 days, sets reviewee_role, and recomputes ratings strictly from hidden = false
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
            'rating', p_rating,
            'reviewer_role', v_reviewer_role,
            'reviewee_role', v_reviewee_role
        )
    );

    RETURN v_review_id;
END;
$$;

-- 5. RPC Function: admin_hide_review
-- Admin can hide an abusive review and recompute recipient ratings atomically
CREATE OR REPLACE FUNCTION public.admin_hide_review(
    p_review_id UUID,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_review RECORD;
    v_new_rating_count INTEGER;
    v_new_rating_avg NUMERIC(3,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- Must be admin
    IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_caller_id) THEN
        RAISE EXCEPTION 'Only platform administrators can hide reviews.';
    END IF;

    SELECT * INTO v_review
    FROM public.reviews
    WHERE id = p_review_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Review not found.';
    END IF;

    IF v_review.hidden THEN
        RETURN; -- already hidden
    END IF;

    -- Hide review
    UPDATE public.reviews
    SET hidden = true,
        hidden_at = now(),
        hidden_by = v_caller_id
    WHERE id = p_review_id;

    -- Recompute recipient per-role rating
    IF v_review.reviewee_role = 'freelancer' THEN
        SELECT
            count(*),
            round(avg(rating)::numeric, 2)
        INTO v_new_rating_count, v_new_rating_avg
        FROM public.reviews
        WHERE reviewee_id = v_review.reviewee_id AND reviewee_role = 'freelancer' AND hidden = false;

        UPDATE public.profiles
        SET freelancer_rating_avg = coalesce(v_new_rating_avg, 0.00),
            freelancer_rating_count = v_new_rating_count,
            updated_at = now()
        WHERE id = v_review.reviewee_id;
    ELSE
        SELECT
            count(*),
            round(avg(rating)::numeric, 2)
        INTO v_new_rating_count, v_new_rating_avg
        FROM public.reviews
        WHERE reviewee_id = v_review.reviewee_id AND reviewee_role = 'client' AND hidden = false;

        UPDATE public.profiles
        SET client_rating_avg = coalesce(v_new_rating_avg, 0.00),
            client_rating_count = v_new_rating_count,
            updated_at = now()
        WHERE id = v_review.reviewee_id;
    END IF;

    -- Audit event
    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'admin_hide_review',
        v_caller_id,
        p_review_id,
        'reviews',
        jsonb_build_object(
            'reviewee_id', v_review.reviewee_id,
            'reason', trim(p_reason)
        )
    );
END;
$$;

-- 6. Update switch_mode to read real reports table for unresolved reports
CREATE OR REPLACE FUNCTION public.get_mode_switch_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Read unresolved reports filed against the user from public.reports
  SELECT count(*) INTO v_unresolved_reports_count
  FROM public.reports
  WHERE target_id = v_user_id AND status = 'pending';

  IF v_unresolved_reports_count > 0 THEN
    v_can_switch := false;
    v_blockers := array_append(v_blockers, 'You have ' || v_unresolved_reports_count || ' unresolved report(s) under review.');
  END IF;

  IF v_profile.active_mode = 'hire' THEN
    SELECT count(*) INTO v_pending_gigs_count
    FROM public.gigs WHERE client_id = v_user_id AND status IN ('open', 'draft');
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

-- 7. Revoke execution from public/anon and grant to authenticated on all protected functions
REVOKE EXECUTE ON FUNCTION public.choose_initial_mode FROM public, anon;
GRANT EXECUTE ON FUNCTION public.choose_initial_mode TO authenticated;

REVOKE EXECUTE ON FUNCTION public.switch_mode FROM public, anon;
GRANT EXECUTE ON FUNCTION public.switch_mode TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_mode_switch_status FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_mode_switch_status TO authenticated;

REVOKE EXECUTE ON FUNCTION public.publish_gig FROM public, anon;
GRANT EXECUTE ON FUNCTION public.publish_gig TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_application FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_application TO authenticated;

REVOKE EXECUTE ON FUNCTION public.respond_to_application FROM public, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_application TO authenticated;

REVOKE EXECUTE ON FUNCTION public.respond_to_counter FROM public, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_counter TO authenticated;

REVOKE EXECUTE ON FUNCTION public.define_milestones FROM public, anon;
GRANT EXECUTE ON FUNCTION public.define_milestones TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_milestone FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_milestone TO authenticated;

REVOKE EXECUTE ON FUNCTION public.review_milestone FROM public, anon;
GRANT EXECUTE ON FUNCTION public.review_milestone TO authenticated;

REVOKE EXECUTE ON FUNCTION public.report_payment FROM public, anon;
GRANT EXECUTE ON FUNCTION public.report_payment TO authenticated;

REVOKE EXECUTE ON FUNCTION public.confirm_payment FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_payment TO authenticated;

REVOKE EXECUTE ON FUNCTION public.dispute_payment FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dispute_payment TO authenticated;

REVOKE EXECUTE ON FUNCTION public.complete_agreement FROM public, anon;
GRANT EXECUTE ON FUNCTION public.complete_agreement TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_review FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_review TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_hide_review FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_hide_review TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_or_create_conversation FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation TO authenticated;

REVOKE EXECUTE ON FUNCTION public.send_message FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_message TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_report FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_report TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_agreement FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_agreement TO authenticated;
