-- Milestone 4: Applications, Agreements, and Mode Switching Engine
-- 100% Supabase. Atomic operations with row locks and partial unique index.

-- 1. rate_limit_events table
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events ON public.rate_limit_events (user_id, action, created_at DESC);
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;
-- No client access: default deny

-- 2. applications table
CREATE TABLE IF NOT EXISTS public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id uuid NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proposed_price integer NOT NULL CHECK (proposed_price > 0),
  estimated_days integer NOT NULL CHECK (estimated_days > 0),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'accepted', 'declined', 'countered', 'withdrawn')),
  counter_price integer CHECK (counter_price IS NULL OR counter_price > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gig_id, freelancer_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_gig_id ON public.applications (gig_id);
CREATE INDEX IF NOT EXISTS idx_applications_freelancer_id ON public.applications (freelancer_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications (status);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- Applications RLS:
-- Visible only to applicant or gig owner
CREATE POLICY "Applicant can view own applications"
  ON public.applications
  FOR SELECT
  TO authenticated
  USING (
    freelancer_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.gigs
      WHERE id = applications.gig_id AND client_id = auth.uid()
    )
  );

-- Direct client inserts, updates, deletes are denied (mutations through RPCs only)
REVOKE INSERT, UPDATE, DELETE ON public.applications FROM anon, authenticated;

-- 3. agreements table
CREATE TABLE IF NOT EXISTS public.agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id uuid NOT NULL REFERENCES public.gigs(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  agreed_price integer NOT NULL CHECK (agreed_price > 0),
  deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'disputed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique index: exactly one active agreement per gig
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_agreement_per_gig 
  ON public.agreements (gig_id) 
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_agreements_client_id ON public.agreements (client_id);
CREATE INDEX IF NOT EXISTS idx_agreements_freelancer_id ON public.agreements (freelancer_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON public.agreements (status);

ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;

-- Agreements RLS:
-- Visible only to agreement participants and admins
CREATE POLICY "Participants can view agreement"
  ON public.agreements
  FOR SELECT
  TO authenticated
  USING (
    client_id = auth.uid() OR
    freelancer_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
  );

-- Direct client writes are revoked
REVOKE INSERT, UPDATE, DELETE ON public.agreements FROM anon, authenticated;

-- 4. RPC Function: submit_application
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

  -- Input validations
  IF p_proposed_price IS NULL OR p_proposed_price <= 0 THEN
    RAISE EXCEPTION 'Proposed price must be greater than zero.';
  END IF;
  IF p_estimated_days IS NULL OR p_estimated_days <= 0 THEN
    RAISE EXCEPTION 'Estimated days must be greater than zero.';
  END IF;
  IF p_message IS NULL OR trim(p_message) = '' THEN
    RAISE EXCEPTION 'Application message is required.';
  END IF;

  -- Rate limit check (max 10 applications per hour)
  SELECT count(*) INTO v_recent_app_count
  FROM public.rate_limit_events
  WHERE user_id = v_user_id
    AND action = 'submit_application'
    AND created_at > (now() - interval '1 hour');

  IF v_recent_app_count >= 10 THEN
    RAISE EXCEPTION 'Application rate limit reached. Please wait before submitting more applications.';
  END IF;

  -- Lock gig and verify eligibility
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

  -- Check freelancer profile gates
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
    RAISE EXCEPTION 'You must add a profile photo before applying for gigs.';
  END IF;

  -- Gate: at least 1 skill in profile_skills
  SELECT EXISTS (
    SELECT 1 FROM public.profile_skills WHERE profile_id = v_user_id
  ) INTO v_has_skill;

  IF NOT v_has_skill THEN
    RAISE EXCEPTION 'You must add at least 1 skill to your profile before applying.';
  END IF;

  -- Gate: email confirmed
  SELECT (email_confirmed_at IS NOT NULL) INTO v_email_confirmed
  FROM auth.users
  WHERE id = v_user_id;

  IF v_email_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'You must confirm your email address before applying.';
  END IF;

  -- Insert application
  INSERT INTO public.applications (
    gig_id,
    freelancer_id,
    proposed_price,
    estimated_days,
    message,
    status
  )
  VALUES (
    p_gig_id,
    v_user_id,
    p_proposed_price,
    p_estimated_days,
    trim(p_message),
    'applied'
  )
  RETURNING id INTO v_app_id;

  -- Record rate limit and audit events
  INSERT INTO public.rate_limit_events (user_id, action)
  VALUES (v_user_id, 'submit_application');

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'submit_application',
    'applications',
    v_app_id,
    jsonb_build_object('gig_id', p_gig_id, 'price', p_proposed_price)
  );

  RETURN v_app_id;
END;
$$;

-- 5. RPC Function: respond_to_application
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
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_action NOT IN ('accept', 'decline', 'counter') THEN
    RAISE EXCEPTION 'Invalid response action. Must be accept, decline, or counter.';
  END IF;

  -- Lock application row
  SELECT * INTO v_app
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  -- Lock gig row
  SELECT * INTO v_gig
  FROM public.gigs
  WHERE id = v_app.gig_id
  FOR UPDATE;

  IF v_gig.client_id <> v_user_id THEN
    RAISE EXCEPTION 'Only the client who posted the gig can respond to applicants.';
  END IF;

  IF v_app.status <> 'applied' THEN
    RAISE EXCEPTION 'This application has already been responded to (current status: %)', v_app.status;
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.applications
    SET status = 'declined', updated_at = now()
    WHERE id = p_application_id;

    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_user_id, 'decline_application', 'applications', p_application_id, jsonb_build_object('gig_id', v_gig.id));

    RETURN NULL;

  ELSIF p_action = 'counter' THEN
    IF p_counter_price IS NULL OR p_counter_price <= 0 THEN
      RAISE EXCEPTION 'Counteroffer price must be greater than zero.';
    END IF;

    UPDATE public.applications
    SET status = 'countered',
        counter_price = p_counter_price,
        updated_at = now()
    WHERE id = p_application_id;

    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_user_id, 'counter_application', 'applications', p_application_id, jsonb_build_object('counter_price', p_counter_price));

    RETURN NULL;

  ELSIF p_action = 'accept' THEN
    -- Check if an active agreement already exists on this gig
    IF EXISTS (
      SELECT 1 FROM public.agreements
      WHERE gig_id = v_gig.id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'An active agreement already exists for this gig.';
    END IF;

    -- Update application status
    UPDATE public.applications
    SET status = 'accepted', updated_at = now()
    WHERE id = p_application_id;

    -- Atomically create agreement
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
      v_user_id,
      v_app.freelancer_id,
      v_app.proposed_price,
      v_gig.deadline,
      'active'
    )
    RETURNING id INTO v_agreement_id;

    -- Update gig status to in_progress
    UPDATE public.gigs
    SET status = 'in_progress', updated_at = now()
    WHERE id = v_gig.id;

    -- Decline all other pending applications for this gig
    UPDATE public.applications
    SET status = 'declined', updated_at = now()
    WHERE gig_id = v_gig.id AND id <> p_application_id AND status IN ('applied', 'countered');

    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_user_id,
      'accept_application',
      'agreements',
      v_agreement_id,
      jsonb_build_object('gig_id', v_gig.id, 'freelancer_id', v_app.freelancer_id, 'price', v_app.proposed_price)
    );

    RETURN v_agreement_id;
  END IF;

  RETURN NULL;
END;
$$;

-- 6. RPC Function: respond_to_counter
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
    RAISE EXCEPTION 'Application is not in countered status.';
  END IF;

  -- Lock gig
  SELECT * INTO v_gig
  FROM public.gigs
  WHERE id = v_app.gig_id
  FOR UPDATE;

  IF p_action IN ('decline', 'withdraw') THEN
    UPDATE public.applications
    SET status = p_action, updated_at = now()
    WHERE id = p_application_id;

    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_user_id, p_action || '_counter', 'applications', p_application_id, jsonb_build_object('gig_id', v_gig.id));

    RETURN NULL;

  ELSIF p_action = 'accept' THEN
    -- Check if agreement already exists
    IF EXISTS (
      SELECT 1 FROM public.agreements
      WHERE gig_id = v_gig.id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'An active agreement already exists for this gig.';
    END IF;

    UPDATE public.applications
    SET status = 'accepted', updated_at = now()
    WHERE id = p_application_id;

    -- Create agreement with agreed_price = counter_price
    INSERT INTO public.agreements (
      gig_id,
      client_id,
      freelancer_id,
      agreed_price,
      deadline,
      status
    )
    VALUES (
      v_gig.client_id,
      v_user_id,
      v_gig.client_id,
      v_app.counter_price,
      v_gig.deadline,
      'active'
    )
    RETURNING id INTO v_agreement_id;

    UPDATE public.gigs
    SET status = 'in_progress', updated_at = now()
    WHERE id = v_gig.id;

    -- Decline all other pending applications
    UPDATE public.applications
    SET status = 'declined', updated_at = now()
    WHERE gig_id = v_gig.id AND id <> p_application_id AND status IN ('applied', 'countered');

    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_user_id,
      'accept_counter',
      'agreements',
      v_agreement_id,
      jsonb_build_object('gig_id', v_gig.id, 'price', v_app.counter_price)
    );

    RETURN v_agreement_id;
  END IF;

  RETURN NULL;
END;
$$;

-- 7. Helper Function: get_mode_switch_status
CREATE OR REPLACE FUNCTION public.get_mode_switch_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_days_since_switch numeric;
  v_cooldown_remaining_days integer := 0;
  v_blockers text[] := '{}';
  v_has_active_agreement boolean;
  v_pending_gigs_count integer := 0;
  v_pending_apps_count integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_profile.status <> 'active' THEN
    v_blockers := array_append(v_blockers, 'Account is not in active status (' || v_profile.status || ').');
  END IF;

  -- 1. Cooldown check (7 days)
  IF v_profile.mode_changed_at IS NOT NULL THEN
    v_days_since_switch := EXTRACT(EPOCH FROM (now() - v_profile.mode_changed_at)) / 86400;
    IF v_days_since_switch < 7 THEN
      v_cooldown_remaining_days := CEIL(7 - v_days_since_switch)::integer;
      v_blockers := array_append(v_blockers, 'Cooldown period active: ' || v_cooldown_remaining_days || ' day(s) remaining.');
    END IF;
  END IF;

  -- 2. Check for active or disputed agreements
  SELECT EXISTS (
    SELECT 1 FROM public.agreements
    WHERE (client_id = v_user_id OR freelancer_id = v_user_id)
      AND status IN ('active', 'disputed')
  ) INTO v_has_active_agreement;

  IF v_has_active_agreement THEN
    v_blockers := array_append(v_blockers, 'You have an active or disputed agreement that must be completed first.');
  END IF;

  -- Count pending items that will be affected upon confirmation
  IF v_profile.active_mode = 'hire' THEN
    SELECT count(*) INTO v_pending_gigs_count
    FROM public.gigs
    WHERE client_id = v_user_id AND status IN ('draft', 'open');
  ELSIF v_profile.active_mode = 'find_work' THEN
    SELECT count(*) INTO v_pending_apps_count
    FROM public.applications
    WHERE freelancer_id = v_user_id AND status IN ('applied', 'countered');
  END IF;

  RETURN jsonb_build_object(
    'current_mode', v_profile.active_mode,
    'can_switch', (array_length(v_blockers, 1) IS NULL),
    'cooldown_remaining_days', v_cooldown_remaining_days,
    'blockers', v_blockers,
    'pending_gigs_count', v_pending_gigs_count,
    'pending_apps_count', v_pending_apps_count
  );
END;
$$;

-- 8. RPC Function: switch_mode
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
  v_blockers text[];
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
    -- Cancel draft and open gigs
    UPDATE public.gigs
    SET status = 'cancelled', updated_at = now()
    WHERE client_id = v_user_id AND status IN ('draft', 'open');

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
