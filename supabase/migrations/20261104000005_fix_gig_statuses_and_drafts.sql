-- Migration: 20261104000005_fix_gig_statuses_and_drafts.sql
-- Fixes gigs_status_check to allow 'draft', 'closed', 'expired', and updates create_draft_gig / rpc_create_or_update_gig

ALTER TABLE public.gigs DROP CONSTRAINT IF EXISTS gigs_status_check;
ALTER TABLE public.gigs ADD CONSTRAINT gigs_status_check
  CHECK (status IN ('draft', 'open', 'in_progress', 'completed', 'cancelled', 'expired', 'closed'));

-- Drop and recreate rpc_create_or_update_gig with p_status support
DROP FUNCTION IF EXISTS public.rpc_create_or_update_gig(uuid, text, text, text, bigint, text, text, text[]);
DROP FUNCTION IF EXISTS public.rpc_create_or_update_gig(uuid, text, text, text, bigint, text, text, text[], text);

CREATE OR REPLACE FUNCTION public.rpc_create_or_update_gig(
  p_gig_id uuid,
  p_title text,
  p_category text,
  p_description text,
  p_budget_centavos bigint,
  p_budget_type text,
  p_location_barangay text,
  p_required_skills text[],
  p_status text DEFAULT 'open'
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
  v_status text := coalesce(nullif(trim(p_status), ''), 'open');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'message', 'Authentication required.');
  END IF;

  SELECT active_mode INTO v_mode FROM public.profiles WHERE id = v_uid;
  IF v_mode NOT IN ('client', 'hire') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN_MODE', 'message', 'Only clients can post or edit gigs.');
  END IF;

  IF p_budget_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BUDGET', 'message', 'Budget must be greater than zero.');
  END IF;

  IF p_gig_id IS NULL THEN
    INSERT INTO public.gigs (
      client_id, title, category, description, budget_centavos, budget_type, location_barangay, required_skills, status
    ) VALUES (
      v_uid, trim(p_title), trim(p_category), trim(p_description), p_budget_centavos, p_budget_type, trim(p_location_barangay), p_required_skills, v_status
    ) RETURNING id INTO v_id;

    PERFORM public.internal_log_audit(v_uid, NULL, 'GIG_CREATED', 'GIGS', NULL, 'SUCCESS', jsonb_build_object('gig_id', v_id, 'status', v_status));
  ELSE
    UPDATE public.gigs
    SET title = trim(p_title), category = trim(p_category), description = trim(p_description),
        budget_centavos = p_budget_centavos, budget_type = p_budget_type, location_barangay = trim(p_location_barangay),
        required_skills = p_required_skills, status = coalesce(v_status, status), updated_at = now()
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

-- Drop and recreate create_draft_gig to insert as 'draft'
DROP FUNCTION IF EXISTS public.create_draft_gig CASCADE;

CREATE OR REPLACE FUNCTION public.create_draft_gig(
  p_title text,
  p_description text,
  p_category_id uuid DEFAULT NULL,
  p_category_name text DEFAULT NULL,
  p_price_min bigint DEFAULT 10000,
  p_price_max bigint DEFAULT 10000,
  p_work_type text DEFAULT 'fixed',
  p_area text DEFAULT 'Ormoc City'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cat text := coalesce(nullif(trim(p_category_name), ''), 'General Services');
  v_loc text := coalesce(nullif(trim(p_area), ''), 'Ormoc City');
  v_budget bigint := greatest(coalesce(p_price_max, p_price_min, 10000), 10000);
  v_btype text := CASE WHEN lower(p_work_type) = 'hourly' THEN 'hourly' ELSE 'fixed' END;
  v_id uuid;
BEGIN
  INSERT INTO public.gigs (
    client_id, title, category, description, budget_centavos, budget_type, location_barangay, required_skills, status
  ) VALUES (
    v_uid, trim(p_title), v_cat, trim(p_description), v_budget, v_btype, v_loc, '{}', 'draft'
  ) RETURNING id INTO v_id;

  RETURN v_id::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_create_or_update_gig TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_draft_gig TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
