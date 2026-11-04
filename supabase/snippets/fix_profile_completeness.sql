CREATE OR REPLACE FUNCTION public.get_profile_completeness(p_profile_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_target uuid := coalesce(p_profile_id, auth.uid());
  v_p public.profiles%ROWTYPE;
  v_role text;
  v_missing jsonb := '[]'::jsonb;
  v_total integer := 5;
  v_done integer := 0;
  v_percent integer := 0;
  v_complete boolean := false;
BEGIN
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'percent', 0, 'complete', false, 'missing_items', '[]'::jsonb);
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_target;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'percent', 0, 'complete', false, 'missing_items', '[]'::jsonb);
  END IF;

  v_role := coalesce(v_p.active_mode, 'find_work');

  IF v_p.avatar_path IS NOT NULL AND trim(v_p.avatar_path) <> '' THEN
    v_done := v_done + 1;
  ELSE
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('key', 'photo', 'label', 'Add a profile photo'));
  END IF;

  IF v_p.display_name IS NOT NULL AND length(trim(v_p.display_name)) >= 2 THEN
    v_done := v_done + 1;
  ELSE
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('key', 'display_name', 'label', 'Add your display name'));
  END IF;

  IF v_p.bio IS NOT NULL AND length(trim(v_p.bio)) >= 20 THEN
    v_done := v_done + 1;
  ELSE
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('key', 'bio', 'label', 'Write a bio (at least 20 characters)'));
  END IF;

  IF v_p.area IS NOT NULL AND length(trim(v_p.area)) >= 2 THEN
    v_done := v_done + 1;
  ELSE
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('key', 'area', 'label', 'Add your barangay or area'));
  END IF;

  IF v_role IN ('hire', 'client') THEN
    IF v_p.client_type IS NOT NULL AND trim(v_p.client_type) <> '' THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('key', 'client_type', 'label', 'Select your client type'));
    END IF;
  ELSE
    IF v_p.headline IS NOT NULL AND trim(v_p.headline) <> '' THEN
      v_done := v_done + 1;
    ELSE
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('key', 'headline', 'label', 'Add a professional headline'));
    END IF;
  END IF;

  v_percent := round((v_done::numeric / v_total::numeric) * 100);
  v_complete := (v_done >= v_total);

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', v_target,
    'role', v_role,
    'percent', v_percent,
    'percentage', v_percent,
    'score', v_percent,
    'complete', v_complete,
    'is_complete', v_complete,
    'missing_items', v_missing,
    'has_portfolio_bonus', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_profile_completeness(uuid) TO anon, authenticated, service_role;
