-- Migration: 20261011000011_notifications.sql
-- Milestone 11: Real In-App Notifications
-- Strictly adheres to AGENTS.md, docs/GIGORMOC_SPEC.md, and docs/REAL_LOGIC_V5.md section 3

-- 1. Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    entity_type TEXT DEFAULT NULL,
    entity_id UUID DEFAULT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    read_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient queries and unread counting
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id) WHERE read_at IS NULL;

-- Enable Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- RLS: Recipient can select own notifications
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
    ON public.notifications
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Direct client writes are revoked (creation only via internal notify helper, updates via RPCs)
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM anon, authenticated, PUBLIC;

-- 2. Add notifications to Supabase Realtime publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
EXCEPTION
    WHEN undefined_object THEN
        NULL;
END $$;

-- 3. Internal helper: notify()
-- Created inside public schema, SECURITY DEFINER, search_path fixed to public, auth, pg_temp
-- Revoked from all external callers (callable only by other DB functions)
DROP FUNCTION IF EXISTS public.notify(UUID, TEXT, TEXT, TEXT, TEXT, UUID, JSONB);
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
BEGIN
    v_actor_id := auth.uid();

    -- Rule: Never notify the actor about their own action
    IF v_actor_id IS NOT NULL AND p_user_id = v_actor_id THEN
        RETURN NULL;
    END IF;

    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        body,
        entity_type,
        entity_id,
        data
    ) VALUES (
        p_user_id,
        p_type,
        trim(p_title),
        trim(p_body),
        p_entity_type,
        p_entity_id,
        coalesce(p_data, '{}'::jsonb)
    )
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$$;

-- Revoke execute on notify() from public, anon, and authenticated
REVOKE ALL ON FUNCTION public.notify(UUID, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- 4. RPCs for reading / dismissing notifications
DROP FUNCTION IF EXISTS public.mark_notification_read(UUID);
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    UPDATE public.notifications
    SET read_at = coalesce(read_at, now())
    WHERE id = p_id AND user_id = v_caller_id;

    RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.mark_all_notifications_read();
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_updated_count INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    UPDATE public.notifications
    SET read_at = now()
    WHERE user_id = v_caller_id AND read_at IS NULL;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

-- 5. Re-create lifecycle RPCs to emit real notifications
-- A. submit_application -> notifies client (application_received)
DROP FUNCTION IF EXISTS public.submit_application(uuid, integer, integer, text);
CREATE OR REPLACE FUNCTION public.submit_application(
  p_gig_id uuid,
  p_proposed_price integer,
  p_estimated_days integer,
  p_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_gig record;
  v_has_skill boolean;
  v_email_confirmed boolean;
  v_recent_app_count integer;
  v_app_id uuid;
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

  SELECT count(*) INTO v_recent_app_count
  FROM public.rate_limit_events
  WHERE user_id = v_user_id
    AND action = 'submit_application'
    AND created_at > (now() - interval '1 hour');

  IF v_recent_app_count >= 10 THEN
    RAISE EXCEPTION 'Application rate limit reached. Please wait before submitting more applications.';
  END IF;

  SELECT * INTO v_gig
  FROM public.gigs
  WHERE id = p_gig_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gig not found.';
  END IF;

  IF v_gig.client_id = v_user_id THEN
    RAISE EXCEPTION 'You cannot apply to your own gig.';
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

  -- Real Notification to gig client
  PERFORM public.notify(
    v_gig.client_id,
    'application_received',
    'New Application Received',
    coalesce(v_profile.display_name, 'A freelancer') || ' applied to your gig "' || v_gig.title || '".',
    'application',
    v_app_id,
    jsonb_build_object('gig_id', p_gig_id)
  );

  RETURN v_app_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_application(uuid, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_application(uuid, integer, integer, text) TO authenticated;

-- B. respond_to_application -> notifies freelancer
DROP FUNCTION IF EXISTS public.respond_to_application(uuid, text, integer);
CREATE OR REPLACE FUNCTION public.respond_to_application(
  p_application_id uuid,
  p_action text,
  p_counter_price integer DEFAULT NULL
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

  IF p_action NOT IN ('accept', 'decline', 'counter') THEN
    RAISE EXCEPTION 'Invalid response action. Must be accept, decline, or counter.';
  END IF;

  SELECT * INTO v_app
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  IF v_app.status <> 'applied' THEN
    RAISE EXCEPTION 'Application is not in applied state (current: %).', v_app.status;
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

    -- Real Notification: application_countered
    PERFORM public.notify(
      v_app.freelancer_id,
      'application_countered',
      'Counteroffer Received',
      'The client countered your proposal on "' || v_gig.title || '".',
      'application',
      p_application_id,
      jsonb_build_object('counter_price', p_counter_price, 'gig_id', v_gig.id)
    );

    RETURN NULL;

  ELSIF p_action = 'decline' THEN
    UPDATE public.applications
    SET status = 'declined',
        updated_at = now()
    WHERE id = p_application_id;

    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_user_id, 'decline_application', 'applications', p_application_id, '{}'::jsonb);

    -- Real Notification: application_declined
    PERFORM public.notify(
      v_app.freelancer_id,
      'application_declined',
      'Application Update',
      'Your application for "' || v_gig.title || '" was not accepted.',
      'application',
      p_application_id,
      jsonb_build_object('gig_id', v_gig.id)
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

      -- Notify other applicants
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

    -- Notify accepted freelancer
    PERFORM public.notify(
      v_app.freelancer_id,
      'application_accepted',
      'Proposal Accepted!',
      'Congratulations! Your proposal for "' || v_gig.title || '" was accepted.',
      'agreement',
      v_agreement_id,
      jsonb_build_object('gig_id', v_gig.id)
    );

    -- Notify both that agreement is created
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

REVOKE EXECUTE ON FUNCTION public.respond_to_application(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_application(uuid, text, integer) TO authenticated;

-- C. define_milestones -> notifies freelancer
DROP FUNCTION IF EXISTS public.define_milestones(UUID, JSONB);
CREATE OR REPLACE FUNCTION public.define_milestones(
    p_agreement_id UUID,
    p_milestones JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_agreement RECORD;
    v_total_amount INTEGER := 0;
    v_elem JSONB;
    v_pos INTEGER := 1;
    v_count INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_agreement.client_id <> v_caller_id AND v_agreement.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only agreement participants can define milestones.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Milestones can only be defined for active agreements.';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.milestones
    WHERE agreement_id = p_agreement_id;

    IF v_count > 0 THEN
        RAISE EXCEPTION 'Milestones have already been defined for this agreement.';
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
            title,
            description,
            amount,
            position,
            status
        ) VALUES (
            p_agreement_id,
            trim(v_elem->>'title'),
            coalesce(trim(v_elem->>'description'), ''),
            (v_elem->>'amount')::integer,
            v_pos,
            'pending'
        );
        v_pos := v_pos + 1;
    END LOOP;

    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'milestones_defined',
        v_caller_id,
        p_agreement_id,
        'agreements',
        jsonb_build_object('count', jsonb_array_length(p_milestones), 'total_amount', v_total_amount)
    );

    -- Notify other party
    IF v_caller_id = v_agreement.client_id THEN
      PERFORM public.notify(
        v_agreement.freelancer_id,
        'milestones_defined',
        'Milestones Defined',
        'Milestones have been defined for your active agreement.',
        'agreement',
        p_agreement_id
      );
    ELSE
      PERFORM public.notify(
        v_agreement.client_id,
        'milestones_defined',
        'Milestones Defined',
        'Milestones have been defined for your active agreement.',
        'agreement',
        p_agreement_id
      );
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB) TO authenticated;

-- D. submit_milestone -> notifies client (milestone_submitted)
DROP FUNCTION IF EXISTS public.submit_milestone(UUID, TEXT, TEXT[]);
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
DECLARE
    v_caller_id UUID;
    v_milestone RECORD;
    v_agreement RECORD;
    v_submission_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_message IS NULL OR char_length(trim(p_message)) < 5 THEN
        RAISE EXCEPTION 'Submission text must be at least 5 characters.';
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

    IF v_agreement.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the assigned freelancer can submit work for this milestone.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Milestones can only be submitted for active agreements.';
    END IF;

    IF v_milestone.status NOT IN ('pending', 'revision_requested') THEN
        RAISE EXCEPTION 'Milestone cannot be submitted in its current status (%).', v_milestone.status;
    END IF;

    INSERT INTO public.submissions (
        milestone_id,
        freelancer_id,
        notes,
        file_paths
    ) VALUES (
        p_milestone_id,
        v_caller_id,
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
        jsonb_build_object('milestone_id', p_milestone_id, 'agreement_id', v_agreement.id)
    );

    -- Notify client
    PERFORM public.notify(
      v_agreement.client_id,
      'milestone_submitted',
      'Milestone Submitted',
      'Work has been submitted for milestone "' || v_milestone.title || '".',
      'agreement',
      v_agreement.id,
      jsonb_build_object('milestone_id', p_milestone_id)
    );

    RETURN v_submission_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_milestone(UUID, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_milestone(UUID, TEXT, TEXT[]) TO authenticated;

-- E. review_milestone -> notifies freelancer (milestone_approved or revision_requested)
DROP FUNCTION IF EXISTS public.review_milestone(UUID, TEXT, TEXT);
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
DECLARE
    v_caller_id UUID;
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

        -- Notify freelancer
        PERFORM public.notify(
          v_agreement.freelancer_id,
          'milestone_approved',
          'Milestone Approved!',
          'Your milestone "' || v_milestone.title || '" has been approved by the client.',
          'agreement',
          v_agreement.id,
          jsonb_build_object('milestone_id', p_milestone_id)
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

        -- Notify freelancer
        PERFORM public.notify(
          v_agreement.freelancer_id,
          'milestone_revision_requested',
          'Revision Requested',
          'The client requested a revision for "' || v_milestone.title || '".',
          'agreement',
          v_agreement.id,
          jsonb_build_object('milestone_id', p_milestone_id, 'feedback', trim(p_feedback))
        );
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.review_milestone(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_milestone(UUID, TEXT, TEXT) TO authenticated;

-- F. report_payment -> notifies freelancer (payment_reported)
DROP FUNCTION IF EXISTS public.report_payment(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.report_payment(UUID, TEXT, INTEGER, TEXT, TEXT, UUID);
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
DECLARE
    v_caller_id UUID;
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

    -- Validate milestone if provided
    IF p_milestone_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.milestones
            WHERE id = p_milestone_id AND agreement_id = p_agreement_id
        ) THEN
            RAISE EXCEPTION 'Milestone does not belong to this agreement.';
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

    -- Notify freelancer
    PERFORM public.notify(
      v_agreement.freelancer_id,
      'payment_reported',
      'Payment Reported',
      'Client reported an external payment of ₱' || (p_amount / 100)::text || '. Please confirm once received.',
      'agreement',
      p_agreement_id,
      jsonb_build_object('payment_id', v_payment_id, 'amount', p_amount)
    );

    RETURN v_payment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_payment(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_payment(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- G. confirm_payment & dispute_payment -> notifies client
DROP FUNCTION IF EXISTS public.confirm_payment(UUID);
DROP FUNCTION IF EXISTS public.confirm_payment(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.confirm_payment(
    p_payment_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_payment RECORD;
    v_agreement RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
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
        RETURN; -- idempotent
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

    -- Notify client
    IF v_agreement IS NOT NULL AND v_agreement.client_id IS NOT NULL THEN
        PERFORM public.notify(
          v_agreement.client_id,
          'payment_confirmed',
          'Payment Confirmed',
          'Freelancer confirmed receipt of external payment (₱' || (v_payment.amount / 100)::text || ').',
          'agreement',
          v_payment.agreement_id,
          jsonb_build_object('payment_id', p_payment_id)
        );
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_payment(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.dispute_payment(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.dispute_payment(
    p_payment_id UUID,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
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

    IF v_payment.status = 'confirmed_received' THEN
        RAISE EXCEPTION 'Cannot dispute a payment that was already confirmed.';
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = v_payment.agreement_id;

    UPDATE public.payments
    SET status = 'disputed',
        dispute_reason = trim(p_reason),
        disputed_at = now(),
        updated_at = now()
    WHERE id = p_payment_id;

    IF v_agreement IS NOT NULL THEN
        UPDATE public.agreements
        SET status = 'in_dispute',
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

    -- Notify client
    IF v_agreement IS NOT NULL AND v_agreement.client_id IS NOT NULL THEN
        PERFORM public.notify(
          v_agreement.client_id,
          'payment_disputed',
          'Payment Disputed',
          'Freelancer disputed payment: ' || trim(p_reason),
          'agreement',
          v_payment.agreement_id,
          jsonb_build_object('payment_id', p_payment_id)
        );
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dispute_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispute_payment(UUID, TEXT) TO authenticated;

-- H. complete_agreement -> notifies both parties (agreement_completed)
DROP FUNCTION IF EXISTS public.complete_agreement(UUID);
CREATE OR REPLACE FUNCTION public.complete_agreement(
    p_agreement_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
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

    -- Notify both parties
    PERFORM public.notify(
      v_agreement.client_id,
      'agreement_completed',
      'Agreement Completed',
      'Agreement for gig has been successfully completed! You may now submit a review within 14 days.',
      'agreement',
      p_agreement_id
    );

    PERFORM public.notify(
      v_agreement.freelancer_id,
      'agreement_completed',
      'Agreement Completed',
      'Agreement for gig has been successfully completed! You may now submit a review within 14 days.',
      'agreement',
      p_agreement_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_agreement(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_agreement(UUID) TO authenticated;
