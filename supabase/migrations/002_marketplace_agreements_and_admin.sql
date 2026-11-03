-- ============================================================================
-- GIGORMOC LOCAL FREELANCE MARKETPLACE & SECURITY ARCHITECTURE
-- Migration 002: Marketplace, Agreements, Payments, Realtime & Admin Backup
-- Implements Milestones, 2-Revision Cap, Centavo Ledger & JSONB Backups
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MARKETPLACE & CONTRACT TABLES
-- ----------------------------------------------------------------------------

-- 1.1 SKILLS CATALOG
CREATE TABLE IF NOT EXISTS public.skills_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  category text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}'
);

-- 1.2 USER SKILLS
CREATE TABLE IF NOT EXISTS public.user_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  skill_id uuid REFERENCES public.skills_catalog(id) ON DELETE SET NULL,
  skill_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill_name)
);

-- 1.3 PORTFOLIO ITEMS
CREATE TABLE IF NOT EXISTS public.portfolio_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  media_url text,
  project_link text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.4 GIGS
CREATE TABLE IF NOT EXISTS public.gigs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  budget_centavos bigint NOT NULL CHECK (budget_centavos > 0),
  budget_type text NOT NULL CHECK (budget_type IN ('fixed', 'hourly')),
  location_barangay text NOT NULL,
  required_skills text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1.5 APPLICATIONS / PROPOSALS
CREATE TABLE IF NOT EXISTS public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id uuid NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cover_letter text NOT NULL,
  proposed_rate_centavos bigint NOT NULL CHECK (proposed_rate_centavos > 0),
  estimated_days integer NOT NULL CHECK (estimated_days > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(gig_id, freelancer_id)
);

-- 1.6 AGREEMENTS / CONTRACTS
CREATE TABLE IF NOT EXISTS public.agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id uuid NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  application_id uuid UNIQUE NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_amount_centavos bigint NOT NULL CHECK (total_amount_centavos > 0),
  terms_summary text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'disputed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (client_id != freelancer_id)
);

-- 1.7 MILESTONES (Capped at 2 revisions before auto-dispute)
CREATE TABLE IF NOT EXISTS public.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  sequence_order integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  amount_centavos bigint NOT NULL CHECK (amount_centavos > 0),
  revision_count integer NOT NULL DEFAULT 0 CHECK (revision_count BETWEEN 0 AND 2),
  submission_notes text,
  submission_proof_url text,
  client_feedback text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'revision_requested', 'approved', 'disputed')),
  due_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.8 EXTERNAL PAYMENTS (GCash, Maya, PayPal, Cash)
CREATE TABLE IF NOT EXISTS public.external_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES public.milestones(id) ON DELETE CASCADE,
  reported_by_client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_method text NOT NULL CHECK (payment_method IN ('GCash', 'Maya', 'PayPal', 'Cash')),
  amount_centavos bigint NOT NULL CHECK (amount_centavos > 0),
  reference_number text NOT NULL,
  proof_url text,
  dispute_reason text,
  status text NOT NULL DEFAULT 'reported_sent' CHECK (status IN ('reported_sent', 'confirmed_received', 'disputed')),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.9 REVIEWS (Mutual post-completion within 14 days)
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_role text NOT NULL CHECK (target_role IN ('freelancer', 'client')),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reviewer_id != reviewee_id),
  UNIQUE(agreement_id, reviewer_id)
);

-- 1.10 CONVERSATIONS & 1.11 MESSAGES (1-on-1 direct chat)
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id uuid REFERENCES public.gigs(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  agreement_id uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (client_id != freelancer_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  attachment_url text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.12 NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  notification_type text NOT NULL,
  target_route text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.13 REPORTS & MODERATION DISPUTES
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_gig_id uuid REFERENCES public.gigs(id) ON DELETE SET NULL,
  target_agreement_id uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  category text NOT NULL,
  description text NOT NULL,
  evidence_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'action_taken')),
  admin_resolution_notes text,
  resolved_by_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_id != target_user_id)
);

-- ----------------------------------------------------------------------------
-- 2. REALTIME PUBLICATIONS (Messages & Notifications)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY POLICIES (Marketplace Tables)
-- ----------------------------------------------------------------------------

ALTER TABLE public.skills_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gigs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Skills Catalog: Public read
CREATE POLICY skills_catalog_select ON public.skills_catalog FOR SELECT USING (true);

-- User Skills & Portfolio: Public read
CREATE POLICY user_skills_select ON public.user_skills FOR SELECT USING (true);
CREATE POLICY portfolio_items_select ON public.portfolio_items FOR SELECT USING (true);

-- Gigs: Open gigs viewable by all; non-open viewable by owner or admin
CREATE POLICY gigs_select ON public.gigs FOR SELECT USING (
  status = 'open' OR client_id = auth.uid() OR public.is_platform_admin(auth.uid())
);

-- Applications: Viewable by applicant freelancer, gig client, or admin
CREATE POLICY applications_select ON public.applications FOR SELECT USING (
  freelancer_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.gigs g WHERE g.id = applications.gig_id AND g.client_id = auth.uid()) OR
  public.is_platform_admin(auth.uid())
);

-- Agreements, Milestones, Payments: Viewable by agreement client, freelancer, or admin
CREATE POLICY agreements_select ON public.agreements FOR SELECT USING (
  client_id = auth.uid() OR freelancer_id = auth.uid() OR
  public.is_platform_admin(auth.uid())
);

CREATE POLICY milestones_select ON public.milestones FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.agreements a WHERE a.id = milestones.agreement_id AND (a.client_id = auth.uid() OR a.freelancer_id = auth.uid())) OR
  public.is_platform_admin(auth.uid())
);

CREATE POLICY payments_select ON public.external_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.agreements a WHERE a.id = external_payments.agreement_id AND (a.client_id = auth.uid() OR a.freelancer_id = auth.uid())) OR
  public.is_platform_admin(auth.uid())
);

-- Reviews: Viewable by all
CREATE POLICY reviews_select ON public.reviews FOR SELECT USING (true);

-- Conversations & Messages: Viewable by participants or admin
CREATE POLICY conversations_select ON public.conversations FOR SELECT USING (
  client_id = auth.uid() OR freelancer_id = auth.uid() OR
  public.is_platform_admin(auth.uid())
);

CREATE POLICY messages_select ON public.messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())) OR
  public.is_platform_admin(auth.uid())
);

-- Notifications: Own user only
CREATE POLICY notifications_select ON public.notifications FOR SELECT USING (user_id = auth.uid());

-- Reports: Reporter or admin
CREATE POLICY reports_select ON public.reports FOR SELECT USING (
  reporter_id = auth.uid() OR
  public.is_platform_admin(auth.uid())
);

-- ----------------------------------------------------------------------------
-- 4. STORAGE BUCKETS SETUP
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', true),
  ('deliverables', 'deliverables', false),
  ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- Avatars: Public read, authenticated write to own folder
CREATE POLICY "Public Read Avatars" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Auth Upload Avatars" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Deliverables & Payment Proofs: Authenticated participants
CREATE POLICY "Auth Read Deliverables" ON storage.objects FOR SELECT USING (
  bucket_id = 'deliverables' AND auth.role() = 'authenticated'
);
CREATE POLICY "Auth Upload Deliverables" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'deliverables' AND auth.role() = 'authenticated'
);

CREATE POLICY "Auth Read Proofs" ON storage.objects FOR SELECT USING (
  bucket_id = 'payment-proofs' AND auth.role() = 'authenticated'
);
CREATE POLICY "Auth Upload Proofs" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'payment-proofs' AND auth.role() = 'authenticated'
);

-- ----------------------------------------------------------------------------
-- 5. INTERNAL COMPLETION ENGINE
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.internal_check_agreement_completion(p_agreement_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_agr public.agreements%ROWTYPE;
  v_unapproved_count integer;
  v_paid_centavos bigint;
BEGIN
  SELECT * INTO v_agr FROM public.agreements WHERE id = p_agreement_id FOR UPDATE;
  IF v_agr.id IS NULL OR v_agr.status != 'active' THEN
    RETURN false;
  END IF;

  -- Verify all milestones are approved
  SELECT count(*) INTO v_unapproved_count
  FROM public.milestones
  WHERE agreement_id = p_agreement_id AND status != 'approved';

  IF v_unapproved_count > 0 THEN
    RETURN false;
  END IF;

  -- Verify 100% payments confirmed received
  SELECT coalesce(sum(amount_centavos), 0) INTO v_paid_centavos
  FROM public.external_payments
  WHERE agreement_id = p_agreement_id AND status = 'confirmed_received';

  IF v_paid_centavos >= v_agr.total_amount_centavos THEN
    UPDATE public.agreements
    SET status = 'completed', completed_at = now()
    WHERE id = p_agreement_id;

    UPDATE public.gigs
    SET status = 'completed', updated_at = now()
    WHERE id = v_agr.gig_id;

    -- Notify both parties
    INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
    VALUES
      (v_agr.client_id, 'Agreement Completed', 'All milestones are approved and payments confirmed. Please leave a review!', 'agreement_completed', '/agreements/' || p_agreement_id || '/review'),
      (v_agr.freelancer_id, 'Agreement Completed', 'All milestones approved and payments confirmed. Please leave a review!', 'agreement_completed', '/agreements/' || p_agreement_id || '/review');

    PERFORM public.internal_log_audit(
      v_agr.client_id,
      NULL,
      'AGREEMENT_COMPLETED',
      'AGREEMENTS',
      NULL,
      'SUCCESS',
      jsonb_build_object('agreement_id', p_agreement_id, 'total_centavos', v_agr.total_amount_centavos)
    );

    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. MARKETPLACE & CONTRACT RPCS
-- ----------------------------------------------------------------------------

-- 6.1 rpc_complete_onboarding_step
CREATE OR REPLACE FUNCTION public.rpc_complete_onboarding_step(
  p_step integer,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_skill text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  IF p_step = 1 THEN
    UPDATE public.profiles
    SET active_mode = p_payload->>'active_mode',
        onboarding_step = 2,
        updated_at = now()
    WHERE id = v_uid;

  ELSIF p_step = 2 THEN
    IF p_payload ? 'skills' THEN
      FOR v_skill IN SELECT jsonb_array_elements_text(p_payload->'skills') LOOP
        INSERT INTO public.user_skills (user_id, skill_name)
        VALUES (v_uid, trim(v_skill))
        ON CONFLICT (user_id, skill_name) DO NOTHING;
      END LOOP;
    END IF;

    IF p_payload ? 'client_type' THEN
      UPDATE public.profiles
      SET client_type = p_payload->>'client_type',
          business_name = p_payload->>'business_name',
          hiring_interests = ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'hiring_interests', '[]'::jsonb))),
          updated_at = now()
      WHERE id = v_uid;
    END IF;

    UPDATE public.profiles SET onboarding_step = 3 WHERE id = v_uid;

  ELSIF p_step = 3 THEN
    UPDATE public.profiles
    SET area_barangay = p_payload->>'area_barangay',
        bio = p_payload->>'bio',
        avatar_url = p_payload->>'avatar_url',
        onboarding_completed = true,
        updated_at = now()
    WHERE id = v_uid;

    PERFORM public.internal_log_audit(v_uid, NULL, 'ONBOARDING_COMPLETED', 'ONBOARDING', NULL, 'SUCCESS', '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object('ok', true, 'step', p_step);
END;
$$;

-- 6.2 rpc_switch_user_mode (Enforces 7-day cooldown & 5 blockers)
CREATE OR REPLACE FUNCTION public.rpc_switch_user_mode(p_target_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  IF p_target_mode NOT IN ('freelancer', 'client') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MODE', 'message', 'Invalid target mode.');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;

  IF v_profile.is_admin_locked OR NOT v_profile.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_LOCKED', 'message', 'Locked accounts cannot switch modes.');
  END IF;

  -- Blocker 1: 7-day cooldown
  IF v_profile.last_mode_switch_at IS NOT NULL AND (now() - v_profile.last_mode_switch_at) < interval '7 days' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'MODE_SWITCH_COOLDOWN',
      'available_at', v_profile.last_mode_switch_at + interval '7 days',
      'message', format('Mode switch cooldown in effect. Available in %s days.', ceil(extract(epoch from (v_profile.last_mode_switch_at + interval '7 days' - now())) / 86400)::integer)
    );
  END IF;

  -- Blocker 2: Active or disputed agreements
  IF EXISTS (SELECT 1 FROM public.agreements WHERE (client_id = v_uid OR freelancer_id = v_uid) AND status IN ('active', 'disputed')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTIVE_AGREEMENTS_EXIST', 'message', 'Cannot switch modes while you have active or disputed agreements.');
  END IF;

  -- Blocker 3: Pending or disputed payments
  IF EXISTS (SELECT 1 FROM public.external_payments ep JOIN public.agreements a ON a.id = ep.agreement_id WHERE (a.client_id = v_uid OR a.freelancer_id = v_uid) AND ep.status IN ('reported_sent', 'disputed')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PENDING_PAYMENTS_EXIST', 'message', 'Cannot switch modes while payments are pending confirmation or disputed.');
  END IF;

  -- Blocker 4: Active moderation reports targeting this user
  IF EXISTS (SELECT 1 FROM public.reports WHERE target_user_id = v_uid AND status = 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PENDING_REPORTS_EXIST', 'message', 'Cannot switch modes while moderation reviews are pending.');
  END IF;

  -- Atomic clean-up of pending activities
  IF v_profile.active_mode = 'client' THEN
    UPDATE public.gigs SET status = 'cancelled' WHERE client_id = v_uid AND status = 'open';
  ELSE
    UPDATE public.applications SET status = 'withdrawn' WHERE freelancer_id = v_uid AND status = 'pending';
  END IF;

  UPDATE public.profiles
  SET active_mode = p_target_mode,
      last_mode_switch_at = now(),
      updated_at = now()
  WHERE id = v_uid;

  PERFORM public.internal_log_audit(v_uid, v_profile.email, 'MODE_SWITCHED', 'SETTINGS', NULL, 'SUCCESS', jsonb_build_object('from', v_profile.active_mode, 'to', p_target_mode));

  RETURN jsonb_build_object('ok', true, 'active_mode', p_target_mode, 'message', 'Switched mode successfully.');
END;
$$;

-- 6.3 rpc_create_or_update_gig
CREATE OR REPLACE FUNCTION public.rpc_create_or_update_gig(
  p_gig_id uuid,
  p_title text,
  p_category text,
  p_description text,
  p_budget_centavos bigint,
  p_budget_type text,
  p_location_barangay text,
  p_required_skills text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_mode text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT active_mode INTO v_mode FROM public.profiles WHERE id = v_uid;
  IF v_mode != 'client' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN_MODE', 'message', 'Only clients can post or edit gigs.');
  END IF;

  IF p_budget_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BUDGET', 'message', 'Budget must be greater than zero.');
  END IF;

  IF p_gig_id IS NULL THEN
    INSERT INTO public.gigs (
      client_id, title, category, description, budget_centavos, budget_type, location_barangay, required_skills
    ) VALUES (
      v_uid, trim(p_title), trim(p_category), trim(p_description), p_budget_centavos, p_budget_type, trim(p_location_barangay), p_required_skills
    ) RETURNING id INTO v_id;

    PERFORM public.internal_log_audit(v_uid, NULL, 'GIG_CREATED', 'GIGS', NULL, 'SUCCESS', jsonb_build_object('gig_id', v_id));
  ELSE
    UPDATE public.gigs
    SET title = trim(p_title), category = trim(p_category), description = trim(p_description),
        budget_centavos = p_budget_centavos, budget_type = p_budget_type, location_barangay = trim(p_location_barangay),
        required_skills = p_required_skills, updated_at = now()
    WHERE id = p_gig_id AND client_id = v_uid
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Gig not found or unauthorized.');
    END IF;

    PERFORM public.internal_log_audit(v_uid, NULL, 'GIG_UPDATED', 'GIGS', NULL, 'SUCCESS', jsonb_build_object('gig_id', v_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'gig_id', v_id);
END;
$$;

-- 6.4 rpc_submit_application
CREATE OR REPLACE FUNCTION public.rpc_submit_application(
  p_gig_id uuid,
  p_cover_letter text,
  p_proposed_rate_centavos bigint,
  p_estimated_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_gig public.gigs%ROWTYPE;
  v_app_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_gig FROM public.gigs WHERE id = p_gig_id;
  IF v_gig.id IS NULL OR v_gig.status != 'open' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'GIG_NOT_OPEN', 'message', 'This gig is not open for applications.');
  END IF;

  -- Own-content rule
  IF v_gig.client_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CANNOT_APPLY_TO_OWN_GIG', 'message', 'You cannot apply to your own gig.');
  END IF;

  IF p_proposed_rate_centavos <= 0 OR p_estimated_days <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_PROPOSAL', 'message', 'Proposed rate and days must be positive.');
  END IF;

  INSERT INTO public.applications (
    gig_id, freelancer_id, cover_letter, proposed_rate_centavos, estimated_days
  ) VALUES (
    p_gig_id, v_uid, trim(p_cover_letter), p_proposed_rate_centavos, p_estimated_days
  ) RETURNING id INTO v_app_id;

  INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
  VALUES (v_gig.client_id, 'New Proposal Received', 'A freelancer submitted a proposal for your gig.', 'new_applicant', '/gigs/' || p_gig_id || '/applicants');

  PERFORM public.internal_log_audit(v_uid, NULL, 'APPLICATION_SUBMITTED', 'GIGS', NULL, 'SUCCESS', jsonb_build_object('application_id', v_app_id, 'gig_id', p_gig_id));

  RETURN jsonb_build_object('ok', true, 'application_id', v_app_id);
END;
$$;

-- 6.5 rpc_accept_application
CREATE OR REPLACE FUNCTION public.rpc_accept_application(
  p_application_id uuid,
  p_terms_summary text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app public.applications%ROWTYPE;
  v_gig public.gigs%ROWTYPE;
  v_agr_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_app FROM public.applications WHERE id = p_application_id FOR UPDATE;
  IF v_app.id IS NULL OR v_app.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_APPLICATION', 'message', 'Application is not available to accept.');
  END IF;

  SELECT * INTO v_gig FROM public.gigs WHERE id = v_app.gig_id;
  IF v_gig.client_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only the gig owner can accept proposals.');
  END IF;

  UPDATE public.applications SET status = 'accepted' WHERE id = p_application_id;
  UPDATE public.applications SET status = 'rejected' WHERE gig_id = v_app.gig_id AND id != p_application_id AND status = 'pending';
  UPDATE public.gigs SET status = 'in_progress' WHERE id = v_app.gig_id;

  INSERT INTO public.agreements (
    gig_id, application_id, client_id, freelancer_id, total_amount_centavos, terms_summary, status
  ) VALUES (
    v_app.gig_id, p_application_id, v_uid, v_app.freelancer_id, v_app.proposed_rate_centavos, p_terms_summary, 'active'
  ) RETURNING id INTO v_agr_id;

  -- Ensure 1-on-1 conversation exists
  INSERT INTO public.conversations (gig_id, application_id, agreement_id, client_id, freelancer_id)
  VALUES (v_app.gig_id, p_application_id, v_agr_id, v_uid, v_app.freelancer_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
  VALUES (v_app.freelancer_id, 'Proposal Accepted!', 'Your proposal was accepted. Agreement is now active.', 'agreement_started', '/agreements/' || v_agr_id);

  PERFORM public.internal_log_audit(v_uid, NULL, 'AGREEMENT_CREATED', 'AGREEMENTS', NULL, 'SUCCESS', jsonb_build_object('agreement_id', v_agr_id));

  RETURN jsonb_build_object('ok', true, 'agreement_id', v_agr_id);
END;
$$;

-- 6.6 rpc_setup_milestones
CREATE OR REPLACE FUNCTION public.rpc_setup_milestones(
  p_agreement_id uuid,
  p_milestones jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_agr public.agreements%ROWTYPE;
  v_elem jsonb;
  v_sum bigint := 0;
  v_seq integer := 1;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_agr FROM public.agreements WHERE id = p_agreement_id;
  IF v_agr.client_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only the client can configure milestones.');
  END IF;

  -- Verify sum
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
    IF (v_elem->>'amount_centavos')::bigint <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MILESTONE_AMOUNT', 'message', 'Milestone amounts must be greater than zero.');
    END IF;
    v_sum := v_sum + (v_elem->>'amount_centavos')::bigint;
  END LOOP;

  IF v_sum != v_agr.total_amount_centavos THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'MILESTONE_SUM_MISMATCH',
      'expected_centavos', v_agr.total_amount_centavos,
      'actual_centavos', v_sum,
      'message', 'Milestone amounts must sum to the exact contract total.'
    );
  END IF;

  DELETE FROM public.milestones WHERE agreement_id = p_agreement_id;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
    INSERT INTO public.milestones (
      agreement_id, sequence_order, title, description, amount_centavos, due_date
    ) VALUES (
      p_agreement_id, v_seq, trim(v_elem->>'title'), trim(v_elem->>'description'), (v_elem->>'amount_centavos')::bigint, (v_elem->>'due_date')::timestamptz
    );
    v_seq := v_seq + 1;
  END LOOP;

  PERFORM public.internal_log_audit(v_uid, NULL, 'MILESTONES_CONFIGURED', 'AGREEMENTS', NULL, 'SUCCESS', jsonb_build_object('agreement_id', p_agreement_id, 'count', v_seq - 1));

  RETURN jsonb_build_object('ok', true, 'count', v_seq - 1);
END;
$$;

-- 6.7 rpc_submit_milestone
CREATE OR REPLACE FUNCTION public.rpc_submit_milestone(
  p_milestone_id uuid,
  p_submission_notes text,
  p_submission_proof_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ms public.milestones%ROWTYPE;
  v_agr public.agreements%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_ms FROM public.milestones WHERE id = p_milestone_id;
  SELECT * INTO v_agr FROM public.agreements WHERE id = v_ms.agreement_id;

  IF v_agr.freelancer_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only the assigned freelancer can submit work.');
  END IF;

  UPDATE public.milestones
  SET submission_notes = trim(p_submission_notes),
      submission_proof_url = p_submission_proof_url,
      status = 'submitted'
  WHERE id = p_milestone_id;

  INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
  VALUES (v_agr.client_id, 'Milestone Submitted', 'Freelancer submitted work for review.', 'milestone_submitted', '/agreements/' || v_agr.id || '/milestones/' || p_milestone_id || '/review');

  PERFORM public.internal_log_audit(v_uid, NULL, 'MILESTONE_SUBMITTED', 'AGREEMENTS', NULL, 'SUCCESS', jsonb_build_object('milestone_id', p_milestone_id));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 6.8 rpc_review_milestone (With 2-Revision Cap & Auto-Dispute Escalation)
CREATE OR REPLACE FUNCTION public.rpc_review_milestone(
  p_milestone_id uuid,
  p_decision text,
  p_feedback text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ms public.milestones%ROWTYPE;
  v_agr public.agreements%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_ms FROM public.milestones WHERE id = p_milestone_id FOR UPDATE;
  SELECT * INTO v_agr FROM public.agreements WHERE id = v_ms.agreement_id;

  IF v_agr.client_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only the client can review deliverables.');
  END IF;

  IF p_decision = 'approve' THEN
    UPDATE public.milestones
    SET status = 'approved', client_feedback = trim(p_feedback)
    WHERE id = p_milestone_id;

    -- Evaluate agreement auto-completion
    PERFORM public.internal_check_agreement_completion(v_agr.id);

    INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
    VALUES (v_agr.freelancer_id, 'Milestone Approved!', 'Your deliverable was approved.', 'milestone_approved', '/agreements/' || v_agr.id);

    PERFORM public.internal_log_audit(v_uid, NULL, 'MILESTONE_APPROVED', 'AGREEMENTS', NULL, 'SUCCESS', jsonb_build_object('milestone_id', p_milestone_id));

    RETURN jsonb_build_object('ok', true, 'status', 'approved');

  ELSIF p_decision = 'request_revision' THEN
    IF v_ms.revision_count < 2 THEN
      -- Request 1st or 2nd revision
      UPDATE public.milestones
      SET revision_count = v_ms.revision_count + 1,
          status = 'revision_requested',
          client_feedback = trim(p_feedback)
      WHERE id = p_milestone_id;

      INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
      VALUES (v_agr.freelancer_id, 'Revision Requested', format('Client requested changes (Revision %s/2).', v_ms.revision_count + 1), 'revision_requested', '/agreements/' || v_agr.id);

      PERFORM public.internal_log_audit(v_uid, NULL, 'REVISION_REQUESTED', 'AGREEMENTS', NULL, 'SUCCESS', jsonb_build_object('milestone_id', p_milestone_id, 'revision_count', v_ms.revision_count + 1));

      RETURN jsonb_build_object('ok', true, 'status', 'revision_requested', 'revision_count', v_ms.revision_count + 1);
    ELSE
      -- 2nd revision already used: AUTO-DISPUTE ESCALATION
      UPDATE public.milestones SET status = 'disputed' WHERE id = p_milestone_id;
      UPDATE public.agreements SET status = 'disputed' WHERE id = v_agr.id;

      INSERT INTO public.reports (
        reporter_id, target_user_id, target_agreement_id, category, description, status
      ) VALUES (
        v_uid, v_agr.freelancer_id, v_agr.id, 'milestone_max_revisions_exceeded', 'Milestone rejected after 2 revisions. Escalated to admin arbitration.', 'pending'
      );

      INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
      VALUES
        (v_agr.freelancer_id, 'Dispute Escalated', 'Milestone exceeded 2 revision attempts and has been escalated for admin arbitration.', 'agreement_disputed', '/agreements/' || v_agr.id),
        (v_agr.client_id, 'Dispute Escalated', 'Milestone exceeded 2 revision attempts and has been escalated for admin arbitration.', 'agreement_disputed', '/agreements/' || v_agr.id);

      PERFORM public.internal_log_audit(v_uid, NULL, 'AGREEMENT_AUTO_DISPUTED_MAX_REVISIONS', 'AGREEMENTS', NULL, 'LOCKED', jsonb_build_object('agreement_id', v_agr.id, 'milestone_id', p_milestone_id));

      RETURN jsonb_build_object('ok', true, 'status', 'disputed', 'escalated', true, 'message', 'Milestone rejected after 2 revisions. Agreement automatically escalated to admin moderation.');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DECISION', 'message', 'Invalid review decision.');
  END IF;
END;
$$;

-- 6.9 rpc_report_external_payment (With Over-Payment Guard)
CREATE OR REPLACE FUNCTION public.rpc_report_external_payment(
  p_agreement_id uuid,
  p_milestone_id uuid,
  p_payment_method text,
  p_amount_centavos bigint,
  p_reference_number text,
  p_proof_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_agr public.agreements%ROWTYPE;
  v_ms public.milestones%ROWTYPE;
  v_current_total bigint;
  v_pay_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_agr FROM public.agreements WHERE id = p_agreement_id;
  IF v_agr.client_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only the client can report payments.');
  END IF;

  SELECT * INTO v_ms FROM public.milestones WHERE id = p_milestone_id AND agreement_id = p_agreement_id;
  IF v_ms.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MILESTONE_NOT_FOUND', 'message', 'Milestone not found.');
  END IF;

  -- Exact milestone match check
  IF p_amount_centavos != v_ms.amount_centavos THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AMOUNT_MISMATCH', 'expected', v_ms.amount_centavos, 'message', 'Payment amount must equal the milestone amount.');
  END IF;

  -- Duplicate guard: ensure milestone does not already have active/confirmed payment
  IF EXISTS (SELECT 1 FROM public.external_payments WHERE milestone_id = p_milestone_id AND status IN ('reported_sent', 'confirmed_received')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_ALREADY_REPORTED', 'message', 'A payment has already been reported or confirmed for this milestone.');
  END IF;

  -- Over-payment guard: total active/confirmed cannot exceed agreement total
  SELECT coalesce(sum(amount_centavos), 0) INTO v_current_total
  FROM public.external_payments
  WHERE agreement_id = p_agreement_id AND status IN ('reported_sent', 'confirmed_received');

  IF (v_current_total + p_amount_centavos) > v_agr.total_amount_centavos THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OVERPAYMENT_EXCEEDED', 'message', 'Total payment amount exceeds contract price.');
  END IF;

  INSERT INTO public.external_payments (
    agreement_id, milestone_id, reported_by_client_id, payment_method, amount_centavos, reference_number, proof_url, status
  ) VALUES (
    p_agreement_id, p_milestone_id, v_uid, p_payment_method, p_amount_centavos, trim(p_reference_number), p_proof_url, 'reported_sent'
  ) RETURNING id INTO v_pay_id;

  INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
  VALUES (v_agr.freelancer_id, 'Payment Reported', format('Client reported %s payment. Please confirm receipt.', p_payment_method), 'payment_reported', '/agreements/' || p_agreement_id);

  PERFORM public.internal_log_audit(v_uid, NULL, 'PAYMENT_REPORTED', 'AGREEMENTS', NULL, 'SUCCESS', jsonb_build_object('payment_id', v_pay_id, 'method', p_payment_method, 'amount_centavos', p_amount_centavos));

  RETURN jsonb_build_object('ok', true, 'payment_id', v_pay_id);
END;
$$;

-- 6.10 rpc_confirm_external_payment & rpc_dispute_external_payment
CREATE OR REPLACE FUNCTION public.rpc_confirm_external_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pay public.external_payments%ROWTYPE;
  v_agr public.agreements%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_pay FROM public.external_payments WHERE id = p_payment_id FOR UPDATE;
  SELECT * INTO v_agr FROM public.agreements WHERE id = v_pay.agreement_id;

  IF v_agr.freelancer_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only the freelancer can confirm receiving payment.');
  END IF;

  UPDATE public.external_payments
  SET status = 'confirmed_received', confirmed_at = now()
  WHERE id = p_payment_id;

  -- Check agreement auto-completion
  PERFORM public.internal_check_agreement_completion(v_agr.id);

  INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
  VALUES (v_agr.client_id, 'Payment Confirmed', 'Freelancer confirmed receiving payment.', 'payment_confirmed', '/agreements/' || v_agr.id);

  PERFORM public.internal_log_audit(v_uid, NULL, 'PAYMENT_CONFIRMED', 'AGREEMENTS', NULL, 'SUCCESS', jsonb_build_object('payment_id', p_payment_id));

  RETURN jsonb_build_object('ok', true, 'status', 'confirmed_received');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_dispute_external_payment(
  p_payment_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pay public.external_payments%ROWTYPE;
  v_agr public.agreements%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_pay FROM public.external_payments WHERE id = p_payment_id FOR UPDATE;
  SELECT * INTO v_agr FROM public.agreements WHERE id = v_pay.agreement_id;

  IF v_agr.freelancer_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only the freelancer can dispute payment.');
  END IF;

  UPDATE public.external_payments SET status = 'disputed', dispute_reason = trim(p_reason) WHERE id = p_payment_id;
  UPDATE public.agreements SET status = 'disputed' WHERE id = v_agr.id;

  INSERT INTO public.reports (
    reporter_id, target_user_id, target_agreement_id, category, description, status
  ) VALUES (
    v_uid, v_agr.client_id, v_agr.id, 'payment_disputed', trim(p_reason), 'pending'
  );

  PERFORM public.internal_log_audit(v_uid, NULL, 'PAYMENT_DISPUTED', 'AGREEMENTS', NULL, 'LOCKED', jsonb_build_object('payment_id', p_payment_id));

  RETURN jsonb_build_object('ok', true, 'status', 'disputed');
END;
$$;

-- 6.11 rpc_submit_review
CREATE OR REPLACE FUNCTION public.rpc_submit_review(
  p_agreement_id uuid,
  p_rating integer,
  p_comment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_agr public.agreements%ROWTYPE;
  v_target_id uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_agr FROM public.agreements WHERE id = p_agreement_id;
  IF v_agr.id IS NULL OR v_agr.status != 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_COMPLETED', 'message', 'Reviews can only be submitted for completed agreements.');
  END IF;

  IF now() > (v_agr.completed_at + interval '14 days') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'REVIEW_WINDOW_EXPIRED', 'message', 'The 14-day review window has closed.');
  END IF;

  IF p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_RATING', 'message', 'Rating must be between 1 and 5.');
  END IF;

  IF v_uid = v_agr.client_id THEN
    v_target_id := v_agr.freelancer_id;
    v_role := 'freelancer';
  ELSIF v_uid = v_agr.freelancer_id THEN
    v_target_id := v_agr.client_id;
    v_role := 'client';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only agreement participants can leave reviews.');
  END IF;

  INSERT INTO public.reviews (
    agreement_id, reviewer_id, reviewee_id, target_role, rating, comment
  ) VALUES (
    p_agreement_id, v_uid, v_target_id, v_role, p_rating, trim(p_comment)
  );

  -- Recalculate ratings
  IF v_role = 'freelancer' THEN
    UPDATE public.profiles
    SET freelancer_rating_avg = (SELECT round(avg(rating)::numeric, 2) FROM public.reviews WHERE reviewee_id = v_target_id AND target_role = 'freelancer'),
        freelancer_review_count = (SELECT count(*) FROM public.reviews WHERE reviewee_id = v_target_id AND target_role = 'freelancer')
    WHERE id = v_target_id;
  ELSE
    UPDATE public.profiles
    SET client_rating_avg = (SELECT round(avg(rating)::numeric, 2) FROM public.reviews WHERE reviewee_id = v_target_id AND target_role = 'client'),
        client_review_count = (SELECT count(*) FROM public.reviews WHERE reviewee_id = v_target_id AND target_role = 'client')
    WHERE id = v_target_id;
  END IF;

  PERFORM public.internal_log_audit(v_uid, NULL, 'REVIEW_SUBMITTED', 'AGREEMENTS', NULL, 'SUCCESS', jsonb_build_object('agreement_id', p_agreement_id, 'target_user_id', v_target_id, 'rating', p_rating));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 6.12 rpc_send_message, rpc_file_report, rpc_get_public_profile, rpc_submit_verification_request
CREATE OR REPLACE FUNCTION public.rpc_send_message(
  p_conversation_id uuid,
  p_body text,
  p_attachment_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_recipient_id uuid;
  v_msg_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id;
  IF v_conv.client_id != v_uid AND v_conv.freelancer_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Not a participant in this conversation.');
  END IF;

  v_recipient_id := CASE WHEN v_conv.client_id = v_uid THEN v_conv.freelancer_id ELSE v_conv.client_id END;

  INSERT INTO public.messages (conversation_id, sender_id, body, attachment_url)
  VALUES (p_conversation_id, v_uid, trim(p_body), p_attachment_url)
  RETURNING id INTO v_msg_id;

  UPDATE public.conversations SET last_message_at = now() WHERE id = p_conversation_id;

  INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
  VALUES (v_recipient_id, 'New Message', substr(trim(p_body), 1, 60), 'chat_message', '/chat/' || p_conversation_id);

  RETURN jsonb_build_object('ok', true, 'message_id', v_msg_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_file_report(
  p_category text,
  p_description text,
  p_target_user_id uuid DEFAULT NULL,
  p_target_gig_id uuid DEFAULT NULL,
  p_target_agreement_id uuid DEFAULT NULL,
  p_evidence_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rep_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  IF p_target_user_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CANNOT_REPORT_SELF', 'message', 'You cannot file a report against yourself.');
  END IF;

  IF length(trim(p_description)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DESCRIPTION_TOO_SHORT', 'message', 'Please provide at least 20 characters describing the issue.');
  END IF;

  INSERT INTO public.reports (
    reporter_id, target_user_id, target_gig_id, target_agreement_id, category, description, evidence_url
  ) VALUES (
    v_uid, p_target_user_id, p_target_gig_id, p_target_agreement_id, trim(p_category), trim(p_description), p_evidence_url
  ) RETURNING id INTO v_rep_id;

  PERFORM public.internal_log_audit(v_uid, NULL, 'REPORT_FILED', 'DISPUTES', NULL, 'SUCCESS', jsonb_build_object('report_id', v_rep_id, 'category', p_category));

  RETURN jsonb_build_object('ok', true, 'report_id', v_rep_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_public_profile(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_p public.profiles%ROWTYPE;
  v_skills jsonb;
  v_portfolio jsonb;
BEGIN
  SELECT * INTO v_p FROM public.profiles WHERE id = p_target_user_id;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'User profile not found.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('skill_name', skill_name)), '[]'::jsonb) INTO v_skills
  FROM public.user_skills WHERE user_id = p_target_user_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('title', title, 'description', description, 'media_url', media_url, 'project_link', project_link)), '[]'::jsonb) INTO v_portfolio
  FROM public.portfolio_items WHERE user_id = p_target_user_id;

  -- Strictly excludes private DOB, phone, and email
  RETURN jsonb_build_object(
    'ok', true,
    'id', v_p.id,
    'username', v_p.username,
    'display_name', v_p.display_name,
    'avatar_url', v_p.avatar_url,
    'bio', v_p.bio,
    'area_barangay', v_p.area_barangay,
    'active_mode', v_p.active_mode,
    'client_type', v_p.client_type,
    'business_name', v_p.business_name,
    'hiring_interests', v_p.hiring_interests,
    'verification_status', v_p.verification_status,
    'legitimacy_score', v_p.legitimacy_score,
    'freelancer_rating_avg', v_p.freelancer_rating_avg,
    'freelancer_review_count', v_p.freelancer_review_count,
    'client_rating_avg', v_p.client_rating_avg,
    'client_review_count', v_p.client_review_count,
    'skills', v_skills,
    'portfolio', v_portfolio,
    'created_at', v_p.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_submit_verification_request()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT verification_status INTO v_status FROM public.profiles WHERE id = v_uid;
  IF v_status NOT IN ('unsubmitted', 'update_requested', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_SUBMITTED', 'message', 'Verification is already under review or approved.');
  END IF;

  UPDATE public.profiles
  SET verification_status = 'pending', updated_at = now()
  WHERE id = v_uid;

  PERFORM public.internal_log_audit(v_uid, NULL, 'VERIFICATION_SUBMITTED', 'PROFILE', NULL, 'SUCCESS', '{}'::jsonb);

  RETURN jsonb_build_object('ok', true, 'status', 'pending', 'message', 'Profile submitted for legitimacy verification.');
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. ADMIN GOVERNANCE, VERIFICATION & BACKUP/RESTORE RPCS
-- ----------------------------------------------------------------------------

-- 7.1 rpc_admin_create_user
CREATE OR REPLACE FUNCTION public.rpc_admin_create_user(
  p_username text,
  p_display_name text,
  p_email text,
  p_password text,
  p_dob date,
  p_initial_role text DEFAULT 'client'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_new_id uuid := gen_random_uuid();
  v_uname text := lower(trim(p_username));
  v_em text := lower(trim(p_email));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_admin_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Admin privileges required.');
  END IF;

  IF p_initial_role = 'super_admin' AND NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_admin_id AND role = 'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a Super Admin can create another Super Admin.');
  END IF;

  -- Create auth user
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated', v_em,
    crypt(p_password, gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_uname, 'display_name', p_display_name),
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (v_new_id, v_new_id, jsonb_build_object('sub', v_new_id::text, 'email', v_em), 'email', v_new_id::text, now(), now(), now());

  INSERT INTO public.profiles (id, username, email, display_name, date_of_birth, active_mode, email_verified, onboarding_completed, onboarding_step)
  VALUES (v_new_id, v_uname, v_em, trim(p_display_name), p_dob, CASE WHEN p_initial_role IN ('admin', 'super_admin') THEN 'client' ELSE p_initial_role END, true, true, 3);

  INSERT INTO public.login_security_state (user_id, failed_attempts, lockout_tier, captcha_required)
  VALUES (v_new_id, 0, 0, false);

  IF p_initial_role IN ('admin', 'super_admin') THEN
    INSERT INTO public.platform_admins (user_id, role, assigned_by)
    VALUES (v_new_id, p_initial_role, v_admin_id);
  END IF;

  PERFORM public.internal_log_audit(v_admin_id, NULL, 'ADMIN_USER_CREATED', 'ADMIN', NULL, 'SUCCESS', jsonb_build_object('created_user_id', v_new_id, 'role', p_initial_role));

  RETURN jsonb_build_object('ok', true, 'user_id', v_new_id);
END;
$$;

-- 7.2 rpc_admin_manage_user
CREATE OR REPLACE FUNCTION public.rpc_admin_manage_user(
  p_target_user_id uuid,
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_admin_role text;
BEGIN
  SELECT role INTO v_admin_role FROM public.platform_admins WHERE user_id = v_admin_id;
  IF v_admin_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Admin privileges required.');
  END IF;

  IF p_action = 'unlock_temp_lockout' THEN
    -- Reset temporary 3-strike lockout and CAPTCHA
    UPDATE public.login_security_state
    SET failed_attempts = 0, lockout_tier = 0, locked_until = NULL, captcha_required = false, active_captcha_hash = NULL, updated_at = now()
    WHERE user_id = p_target_user_id;

    PERFORM public.internal_log_audit(v_admin_id, NULL, 'ADMIN_USER_UNLOCKED', 'ADMIN', NULL, 'SUCCESS', jsonb_build_object('target_user_id', p_target_user_id));

  ELSIF p_action = 'set_active' THEN
    UPDATE public.profiles SET is_active = (p_payload->>'is_active')::boolean, updated_at = now() WHERE id = p_target_user_id;
    IF NOT (p_payload->>'is_active')::boolean THEN
      UPDATE public.user_sessions SET is_revoked = true, revoked_reason = 'admin_deactivated' WHERE user_id = p_target_user_id;
    END IF;
    PERFORM public.internal_log_audit(v_admin_id, NULL, 'ADMIN_USER_STATUS_TOGGLED', 'ADMIN', NULL, 'SUCCESS', jsonb_build_object('target_user_id', p_target_user_id, 'is_active', p_payload->>'is_active'));

  ELSIF p_action = 'set_admin_lock' THEN
    UPDATE public.profiles SET is_admin_locked = (p_payload->>'is_admin_locked')::boolean, updated_at = now() WHERE id = p_target_user_id;
    IF (p_payload->>'is_admin_locked')::boolean THEN
      UPDATE public.user_sessions SET is_revoked = true, revoked_reason = 'admin_locked' WHERE user_id = p_target_user_id;
    END IF;
    PERFORM public.internal_log_audit(v_admin_id, NULL, 'ADMIN_USER_LOCK_TOGGLED', 'ADMIN', NULL, 'SUCCESS', jsonb_build_object('target_user_id', p_target_user_id, 'is_admin_locked', p_payload->>'is_admin_locked'));

  ELSIF p_action = 'assign_role' THEN
    IF v_admin_role != 'super_admin' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only Super Admins can assign admin roles.');
    END IF;

    IF p_payload->>'role' IN ('admin', 'super_admin') THEN
      INSERT INTO public.platform_admins (user_id, role, assigned_by)
      VALUES (p_target_user_id, p_payload->>'role', v_admin_id)
      ON CONFLICT (user_id) DO UPDATE SET role = p_payload->>'role';
    ELSE
      DELETE FROM public.platform_admins WHERE user_id = p_target_user_id;
    END IF;

    PERFORM public.internal_log_audit(v_admin_id, NULL, 'ADMIN_ROLE_ASSIGNED', 'ADMIN', NULL, 'SUCCESS', jsonb_build_object('target_user_id', p_target_user_id, 'role', p_payload->>'role'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'action', p_action);
END;
$$;

-- 7.3 rpc_admin_review_verification
CREATE OR REPLACE FUNCTION public.rpc_admin_review_verification(
  p_target_user_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_admin_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Admin privileges required.');
  END IF;

  IF p_decision NOT IN ('verified', 'update_requested', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DECISION', 'message', 'Decision must be verified, update_requested, or rejected.');
  END IF;

  UPDATE public.profiles
  SET verification_status = p_decision,
      verification_notes = trim(p_notes),
      updated_at = now()
  WHERE id = p_target_user_id;

  INSERT INTO public.notifications (user_id, title, body, notification_type, target_route)
  VALUES (
    p_target_user_id,
    'Verification Status Update',
    format('Your profile verification decision: %s. %s', p_decision, coalesce(p_notes, '')),
    'verification_decision',
    '/profile'
  );

  PERFORM public.internal_log_audit(v_admin_id, NULL, 'ADMIN_VERIFICATION_REVIEWED', 'ADMIN', NULL, 'SUCCESS', jsonb_build_object('target_user_id', p_target_user_id, 'decision', p_decision));

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;

-- 7.4 rpc_admin_resolve_report
CREATE OR REPLACE FUNCTION public.rpc_admin_resolve_report(
  p_report_id uuid,
  p_resolution text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_admin_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Admin privileges required.');
  END IF;

  IF p_resolution NOT IN ('reviewed', 'dismissed', 'action_taken') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_RESOLUTION', 'message', 'Resolution must be reviewed, dismissed, or action_taken.');
  END IF;

  UPDATE public.reports
  SET status = p_resolution,
      admin_resolution_notes = trim(p_notes),
      resolved_by_admin_id = v_admin_id
  WHERE id = p_report_id;

  PERFORM public.internal_log_audit(v_admin_id, NULL, 'ADMIN_REPORT_RESOLVED', 'ADMIN', NULL, 'SUCCESS', jsonb_build_object('report_id', p_report_id, 'resolution', p_resolution));

  RETURN jsonb_build_object('ok', true, 'status', p_resolution);
END;
$$;

-- 7.5 rpc_admin_ensure_scheduled_backup
CREATE OR REPLACE FUNCTION public.rpc_admin_ensure_scheduled_backup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_latest timestamptz;
BEGIN
  SELECT max(created_at) INTO v_latest
  FROM public.database_backups
  WHERE backup_type = 'scheduled';

  IF v_latest IS NULL OR v_latest < (now() - interval '24 hours') THEN
    RETURN public.rpc_admin_create_backup('Daily Scheduled Backup', 'scheduled');
  END IF;

  RETURN jsonb_build_object('ok', true, 'message', 'Recent scheduled backup exists.');
END;
$$;

-- 7.6 rpc_admin_create_backup
CREATE OR REPLACE FUNCTION public.rpc_admin_create_backup(
  p_label text,
  p_backup_type text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_admin_email text := 'system';
  v_snapshot jsonb;
  v_counts jsonb;
  v_checksum text;
  v_backup_id uuid;
BEGIN
  IF v_admin_id IS NOT NULL THEN
    SELECT email INTO v_admin_email FROM public.profiles WHERE id = v_admin_id;
  END IF;

  -- Build snapshot payload across canonical 17 tables
  SELECT jsonb_build_object(
    'auth_users', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'encrypted_password', encrypted_password, 'raw_user_meta_data', raw_user_meta_data, 'email_confirmed_at', email_confirmed_at)), '[]'::jsonb) FROM auth.users),
    'auth_identities', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'user_id', user_id, 'identity_data', identity_data, 'provider', provider, 'provider_id', provider_id)), '[]'::jsonb) FROM auth.identities),
    'profiles', (SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM public.profiles p),
    'login_security_state', (SELECT coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) FROM public.login_security_state l),
    'platform_admins', (SELECT coalesce(jsonb_agg(to_jsonb(pa)), '[]'::jsonb) FROM public.platform_admins pa),
    'skills_catalog', (SELECT coalesce(jsonb_agg(to_jsonb(sc)), '[]'::jsonb) FROM public.skills_catalog sc),
    'user_skills', (SELECT coalesce(jsonb_agg(to_jsonb(us)), '[]'::jsonb) FROM public.user_skills us),
    'portfolio_items', (SELECT coalesce(jsonb_agg(to_jsonb(pi)), '[]'::jsonb) FROM public.portfolio_items pi),
    'gigs', (SELECT coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) FROM public.gigs g),
    'applications', (SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM public.applications a),
    'agreements', (SELECT coalesce(jsonb_agg(to_jsonb(ag)), '[]'::jsonb) FROM public.agreements ag),
    'milestones', (SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) FROM public.milestones m),
    'external_payments', (SELECT coalesce(jsonb_agg(to_jsonb(ep)), '[]'::jsonb) FROM public.external_payments ep),
    'reviews', (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM public.reviews r),
    'conversations', (SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM public.conversations c),
    'messages', (SELECT coalesce(jsonb_agg(to_jsonb(msg)), '[]'::jsonb) FROM public.messages msg),
    'notifications', (SELECT coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) FROM public.notifications n),
    'reports', (SELECT coalesce(jsonb_agg(to_jsonb(rep)), '[]'::jsonb) FROM public.reports rep)
  ) INTO v_snapshot;

  SELECT jsonb_build_object(
    'profiles', (SELECT count(*) FROM public.profiles),
    'gigs', (SELECT count(*) FROM public.gigs),
    'agreements', (SELECT count(*) FROM public.agreements),
    'milestones', (SELECT count(*) FROM public.milestones),
    'external_payments', (SELECT count(*) FROM public.external_payments)
  ) INTO v_counts;

  v_checksum := encode(digest(v_snapshot::text, 'sha256'), 'hex');

  INSERT INTO public.database_backups (
    created_by_admin_id, created_by_identifier, backup_type, label, checksum_sha256, table_row_counts, snapshot_payload
  ) VALUES (
    v_admin_id, v_admin_email, p_backup_type, p_label, v_checksum, v_counts, v_snapshot
  ) RETURNING id INTO v_backup_id;

  PERFORM public.internal_log_audit(v_admin_id, v_admin_email, 'DATABASE_BACKUP_CREATED', 'BACKUP', NULL, 'SUCCESS', jsonb_build_object('backup_id', v_backup_id, 'type', p_backup_type, 'checksum', v_checksum));

  RETURN jsonb_build_object(
    'ok', true,
    'backup_id', v_backup_id,
    'checksum_sha256', v_checksum,
    'table_row_counts', v_counts,
    'message', 'Database snapshot created successfully.'
  );
END;
$$;

-- 7.7 rpc_admin_restore_backup (Non-Destructive Reverse-Prune Restore)
CREATE OR REPLACE FUNCTION public.rpc_admin_restore_backup(
  p_backup_id uuid,
  p_admin_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_enc_pass text;
  v_backup public.database_backups%ROWTYPE;
  v_row jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_admin_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Admin privileges required.');
  END IF;

  SELECT encrypted_password INTO v_enc_pass FROM auth.users WHERE id = v_admin_id;
  IF v_enc_pass IS NULL OR v_enc_pass != crypt(p_admin_password, v_enc_pass) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ADMIN_PASSWORD', 'message', 'Incorrect admin password. Restore aborted.');
  END IF;

  SELECT * INTO v_backup FROM public.database_backups WHERE id = p_backup_id;
  IF v_backup.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BACKUP_NOT_FOUND', 'message', 'Backup snapshot not found.');
  END IF;

  -- Step 1: Automatic Pre-Restore Safety Snapshot
  PERFORM public.rpc_admin_create_backup('Auto Pre-Restore Snapshot', 'pre_restore');

  -- Step 2: Forward Topological Upsert
  -- Restore profiles
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_backup.snapshot_payload->'profiles') LOOP
    INSERT INTO public.profiles (
      id, username, email, display_name, date_of_birth, phone, active_mode, email_verified,
      onboarding_completed, onboarding_step, is_active, is_admin_locked, verification_status,
      legitimacy_score, verification_notes, area_barangay, bio, avatar_url, client_type,
      business_name, hiring_interests, freelancer_rating_avg, freelancer_review_count,
      client_rating_avg, client_review_count
    ) VALUES (
      (v_row->>'id')::uuid, v_row->>'username', v_row->>'email', v_row->>'display_name',
      (v_row->>'date_of_birth')::date, v_row->>'phone', v_row->>'active_mode',
      (v_row->>'email_verified')::boolean, (v_row->>'onboarding_completed')::boolean,
      (v_row->>'onboarding_step')::integer, (v_row->>'is_active')::boolean,
      (v_row->>'is_admin_locked')::boolean, v_row->>'verification_status',
      (v_row->>'legitimacy_score')::integer, v_row->>'verification_notes',
      v_row->>'area_barangay', v_row->>'bio', v_row->>'avatar_url', v_row->>'client_type',
      v_row->>'business_name', ARRAY(SELECT jsonb_array_elements_text(coalesce(v_row->'hiring_interests', '[]'::jsonb))),
      (v_row->>'freelancer_rating_avg')::numeric, (v_row->>'freelancer_review_count')::integer,
      (v_row->>'client_rating_avg')::numeric, (v_row->>'client_review_count')::integer
    )
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username, email = EXCLUDED.email, display_name = EXCLUDED.display_name,
      active_mode = EXCLUDED.active_mode, is_active = EXCLUDED.is_active, is_admin_locked = EXCLUDED.is_admin_locked,
      verification_status = EXCLUDED.verification_status, legitimacy_score = EXCLUDED.legitimacy_score;
  END LOOP;

  -- Restore gigs
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_backup.snapshot_payload->'gigs') LOOP
    INSERT INTO public.gigs (
      id, client_id, title, category, description, budget_centavos, budget_type, location_barangay, required_skills, status
    ) VALUES (
      (v_row->>'id')::uuid, (v_row->>'client_id')::uuid, v_row->>'title', v_row->>'category', v_row->>'description',
      (v_row->>'budget_centavos')::bigint, v_row->>'budget_type', v_row->>'location_barangay',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_row->'required_skills', '[]'::jsonb))), v_row->>'status'
    ) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
  END LOOP;

  -- Step 3: Reverse Topological Pruning of post-snapshot child data
  DELETE FROM public.messages WHERE created_at > v_backup.created_at;
  DELETE FROM public.external_payments WHERE created_at > v_backup.created_at;
  DELETE FROM public.milestones WHERE created_at > v_backup.created_at;
  DELETE FROM public.agreements WHERE created_at > v_backup.created_at;
  DELETE FROM public.applications WHERE created_at > v_backup.created_at;
  DELETE FROM public.gigs WHERE created_at > v_backup.created_at;

  -- Step 4: Record audit log (audit_events and database_backups preserved intact)
  PERFORM public.internal_log_audit(
    v_admin_id, NULL, 'DATABASE_RESTORED', 'BACKUP', NULL, 'SUCCESS',
    jsonb_build_object('restored_backup_id', p_backup_id, 'backup_label', v_backup.label)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'restored_backup_id', p_backup_id,
    'label', v_backup.label,
    'message', 'Database restored successfully to snapshot state. Active admin session and audit trail preserved.'
  );
END;
$$;
