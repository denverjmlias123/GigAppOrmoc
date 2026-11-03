-- Milestone 3: Gigs and Role Mode Alignment
-- Strict adherence to AGENTS.md and docs/GIGORMOC_SPEC.md

-- 1. Align profiles with new active_mode and separate ratings
DO $$
BEGIN
  -- Alter starting_mode if needed or drop default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'starting_mode') THEN
    ALTER TABLE public.profiles DROP COLUMN starting_mode;
  END IF;
END $$;

ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS active_mode text CHECK (active_mode IN ('find_work', 'hire')),
  ADD COLUMN IF NOT EXISTS mode_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS freelancer_rating_avg numeric(3,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS freelancer_rating_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_rating_avg numeric(3,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS client_rating_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freelancer_completed_gigs integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_completed_gigs integer NOT NULL DEFAULT 0;

-- Update profile integrity trigger to protect active_mode and separate ratings
CREATE OR REPLACE FUNCTION public.check_profile_update_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Non-admins cannot alter active_mode, mode_changed_at, rating columns, completed gig counts, or status directly
  IF (NEW.active_mode IS DISTINCT FROM OLD.active_mode OR
      NEW.mode_changed_at IS DISTINCT FROM OLD.mode_changed_at OR
      NEW.freelancer_rating_avg <> OLD.freelancer_rating_avg OR
      NEW.freelancer_rating_count <> OLD.freelancer_rating_count OR
      NEW.client_rating_avg <> OLD.client_rating_avg OR
      NEW.client_rating_count <> OLD.client_rating_count OR
      NEW.freelancer_completed_gigs <> OLD.freelancer_completed_gigs OR
      NEW.client_completed_gigs <> OLD.client_completed_gigs OR
      NEW.rating_avg <> OLD.rating_avg OR
      NEW.rating_count <> OLD.rating_count OR
      NEW.completed_gigs <> OLD.completed_gigs OR
      NEW.status <> OLD.status) THEN
    IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()) THEN
      NEW.active_mode := OLD.active_mode;
      NEW.mode_changed_at := OLD.mode_changed_at;
      NEW.freelancer_rating_avg := OLD.freelancer_rating_avg;
      NEW.freelancer_rating_count := OLD.freelancer_rating_count;
      NEW.client_rating_avg := OLD.client_rating_avg;
      NEW.client_rating_count := OLD.client_rating_count;
      NEW.freelancer_completed_gigs := OLD.freelancer_completed_gigs;
      NEW.client_completed_gigs := OLD.client_completed_gigs;
      NEW.rating_avg := OLD.rating_avg;
      NEW.rating_count := OLD.rating_count;
      NEW.completed_gigs := OLD.completed_gigs;
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Audit events table (append-only, default deny)
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
-- No client access policies for audit_events

-- 3. RPC Function: choose_initial_mode
CREATE OR REPLACE FUNCTION public.choose_initial_mode(target_mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_current_mode text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF target_mode NOT IN ('find_work', 'hire') THEN
    RAISE EXCEPTION 'Invalid mode. Must be find_work or hire.';
  END IF;

  -- Lock row
  SELECT active_mode INTO v_current_mode
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  -- Allowed only while active_mode is null
  IF v_current_mode IS NOT NULL THEN
    RAISE EXCEPTION 'Initial mode has already been chosen. Use switch_mode instead.';
  END IF;

  UPDATE public.profiles
  SET active_mode = target_mode,
      mode_changed_at = now()
  WHERE id = v_user_id;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'choose_initial_mode', 'profiles', v_user_id, jsonb_build_object('mode', target_mode));
END;
$$;

-- 4. Gigs table
CREATE TABLE IF NOT EXISTS public.gigs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  requirements text NOT NULL DEFAULT '',
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  price_min integer NOT NULL CHECK (price_min >= 0),
  price_max integer NOT NULL CHECK (price_max >= price_min),
  work_type text NOT NULL CHECK (work_type IN ('remote', 'face_to_face', 'hybrid')),
  area text DEFAULT '',
  application_deadline timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'in_progress', 'completed', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for gigs
CREATE INDEX IF NOT EXISTS idx_gigs_category_id ON public.gigs (category_id);
CREATE INDEX IF NOT EXISTS idx_gigs_status ON public.gigs (status);
CREATE INDEX IF NOT EXISTS idx_gigs_client_id ON public.gigs (client_id);
CREATE INDEX IF NOT EXISTS idx_gigs_work_type ON public.gigs (work_type);
CREATE INDEX IF NOT EXISTS idx_gigs_created_at ON public.gigs (created_at DESC);

ALTER TABLE public.gigs ENABLE ROW LEVEL SECURITY;

-- Gigs RLS policies
-- Authenticated users can view open gigs
CREATE POLICY "Anyone can view open gigs"
  ON public.gigs
  FOR SELECT
  TO authenticated
  USING (status = 'open' OR client_id = auth.uid());

-- Client can insert own draft gigs
CREATE POLICY "Clients can insert own draft gigs"
  ON public.gigs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id = auth.uid() AND
    status = 'draft'
  );

-- Client can update own draft gigs
CREATE POLICY "Clients can update own draft gigs"
  ON public.gigs
  FOR UPDATE
  TO authenticated
  USING (client_id = auth.uid() AND status = 'draft')
  WITH CHECK (client_id = auth.uid() AND status = 'draft');

-- Client can delete own draft gigs
CREATE POLICY "Clients can delete own draft gigs"
  ON public.gigs
  FOR DELETE
  TO authenticated
  USING (client_id = auth.uid() AND status = 'draft');

-- 5. RPC Function: publish_gig
CREATE OR REPLACE FUNCTION public.publish_gig(p_gig_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_gig record;
  v_email_confirmed boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  -- Lock gig row
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

  IF v_gig.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft gigs can be published.';
  END IF;

  -- Lock profile row and check gates
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  -- Enforce active_mode = hire
  IF v_profile.active_mode <> 'hire' THEN
    RAISE EXCEPTION 'You must be in Hire Someone mode to publish a gig.';
  END IF;

  -- Enforce active account status
  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active.';
  END IF;

  -- Enforce display name set
  IF v_profile.display_name IS NULL OR trim(v_profile.display_name) = '' THEN
    RAISE EXCEPTION 'You must set a display name before publishing a gig.';
  END IF;

  -- Check email confirmation from auth.users
  SELECT (email_confirmed_at IS NOT NULL) INTO v_email_confirmed
  FROM auth.users
  WHERE id = v_user_id;

  IF v_email_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'You must confirm your email address before publishing a gig.';
  END IF;

  -- Validate deadlines
  IF v_gig.application_deadline <= now() THEN
    RAISE EXCEPTION 'Application deadline must be in the future.';
  END IF;

  IF v_gig.deadline < v_gig.application_deadline THEN
    RAISE EXCEPTION 'Project completion deadline must be on or after the application deadline.';
  END IF;

  -- Publish gig atomically
  UPDATE public.gigs
  SET status = 'open',
      updated_at = now()
  WHERE id = p_gig_id;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'publish_gig', 'gigs', p_gig_id, jsonb_build_object('title', v_gig.title));
END;
$$;
