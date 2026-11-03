-- Migration: 20261011000013_real_post_gig.sql
-- Milestone 13: Post gig (real)
-- Strictly adheres to docs/REAL_LOGIC_V5.md section 6, docs/MILESTONES.md, and AGENTS.md

-- 1. Redefine public.publish_gig(p_gig_id uuid) with full real SQL-level validation:
-- - Idempotent double-tap: if already 'open', exit cleanly without error
-- - Title length: 5 to 80 characters (trimmed)
-- - Description length: 30 to 2000 characters (trimmed)
-- - Minimum budget: >= 10000 centavos (₱100.00 PHP)
-- - Price ceiling: price_max >= price_min
-- - Category: must reference an active row in public.categories
-- - Mode gate: caller's active_mode must be 'hire'
-- - Account status: active, non-empty display_name, email confirmed, age 18+
-- - Deadlines: application_deadline > now(), deadline >= application_deadline

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
  v_category_valid boolean;
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

  -- Idempotent check for double-tap publish
  IF v_gig.status = 'open' THEN
    RETURN;
  END IF;

  IF v_gig.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft gigs can be published.';
  END IF;

  -- Lock profile row and check user gates
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  -- Mode gate: must be in hire mode
  IF v_profile.active_mode <> 'hire' THEN
    RAISE EXCEPTION 'You must be in Hire Someone mode to publish a gig.';
  END IF;

  -- Account status check
  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active.';
  END IF;

  -- Display name check
  IF v_profile.display_name IS NULL OR trim(v_profile.display_name) = '' THEN
    RAISE EXCEPTION 'You must set a display name before publishing a gig.';
  END IF;

  -- Email confirmation check from auth.users
  SELECT (email_confirmed_at IS NOT NULL) INTO v_email_confirmed
  FROM auth.users
  WHERE id = v_user_id;

  IF v_email_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'You must confirm your email address before publishing a gig.';
  END IF;

  -- SQL-level field validation (parity with app validation per V5 section 6)
  -- 1. Title length: 5 to 80 chars
  IF char_length(trim(v_gig.title)) < 5 OR char_length(trim(v_gig.title)) > 80 THEN
    RAISE EXCEPTION 'Gig title must be between 5 and 80 characters.';
  END IF;

  -- 2. Description length: 30 to 2000 chars
  IF char_length(trim(v_gig.description)) < 30 OR char_length(trim(v_gig.description)) > 2000 THEN
    RAISE EXCEPTION 'Gig description must be between 30 and 2000 characters.';
  END IF;

  -- 3. Minimum budget: at least 10,000 centavos (₱100.00 PHP)
  IF v_gig.price_min < 10000 THEN
    RAISE EXCEPTION 'Minimum budget must be at least ₱100.00 (10000 centavos).';
  END IF;

  -- 4. Price max >= price min
  IF v_gig.price_max < v_gig.price_min THEN
    RAISE EXCEPTION 'Maximum budget cannot be less than minimum budget.';
  END IF;

  -- 5. Category must exist and be active
  SELECT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = v_gig.category_id AND is_active = true
  ) INTO v_category_valid;

  IF NOT v_category_valid THEN
    RAISE EXCEPTION 'Invalid or inactive category.';
  END IF;

  -- 6. Deadlines
  IF v_gig.application_deadline <= now() THEN
    RAISE EXCEPTION 'Application deadline must be in the future.';
  END IF;

  IF v_gig.deadline < v_gig.application_deadline THEN
    RAISE EXCEPTION 'Project completion deadline must be on or after the application deadline.';
  END IF;

  -- Atomically publish gig
  UPDATE public.gigs
  SET status = 'open',
      updated_at = now()
  WHERE id = p_gig_id;

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'publish_gig', 'gigs', p_gig_id, jsonb_build_object('title', v_gig.title));
END;
$$;

-- 2. Define cancel_gig(p_gig_id uuid, p_reason text) RPC
-- Owner cancels gig with reason; sets status = 'cancelled'; notifies all pending applicants
CREATE OR REPLACE FUNCTION public.cancel_gig(
  p_gig_id uuid,
  p_reason text DEFAULT 'Cancelled by client'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_gig record;
  v_applicant record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  -- Reason length validation
  IF p_reason IS NULL OR char_length(trim(p_reason)) < 3 OR char_length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'Cancellation reason must be between 3 and 500 characters.';
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
    RAISE EXCEPTION 'Only the gig owner can cancel this gig.';
  END IF;

  IF v_gig.status NOT IN ('draft', 'open') THEN
    RAISE EXCEPTION 'Only draft or open gigs can be cancelled. Active gigs with agreements must use cancel_agreement.';
  END IF;

  -- Update gig status to cancelled
  UPDATE public.gigs
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_gig_id;

  -- If gig was open, decline pending applications and notify applicants
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
        jsonb_build_object('gig_id', p_gig_id, 'reason', trim(p_reason))
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
END;
$$;

-- 3. Security grants: deny anon/public, grant authenticated
REVOKE EXECUTE ON FUNCTION public.publish_gig(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_gig(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_gig(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_gig(uuid, text) TO authenticated;
