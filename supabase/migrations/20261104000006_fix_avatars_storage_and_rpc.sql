-- Migration 20261104000006_fix_avatars_storage_and_rpc.sql
-- Fix avatars bucket settings, storage RLS policies, and set_profile_avatar RPC

-- 1. Ensure avatars bucket exists and is properly configured
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 2. Storage RLS policies for avatars
DROP POLICY IF EXISTS "Public Read Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public can view avatars" ON storage.objects;
CREATE POLICY "Public Read Avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Auth Upload Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Auth Upload Avatars" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Auth Update Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Auth Update Avatars" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Auth Delete Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Auth Delete Avatars" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3. RPC: set_profile_avatar (supporting both p_avatar_path and p_avatar_url)
DROP FUNCTION IF EXISTS public.set_profile_avatar(text);
DROP FUNCTION IF EXISTS public.set_profile_avatar(text, text);

CREATE OR REPLACE FUNCTION public.set_profile_avatar(
  p_avatar_path text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target_url text;
  v_prev_path text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  v_target_url := NULLIF(trim(COALESCE(p_avatar_path, p_avatar_url, '')), '');

  SELECT COALESCE(avatar_path, avatar_url) INTO v_prev_path
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  UPDATE public.profiles
  SET avatar_path = v_target_url,
      avatar_url = v_target_url,
      updated_at = now()
  WHERE id = v_uid;

  -- Safe audit log
  BEGIN
    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_uid,
      CASE WHEN v_target_url IS NULL THEN 'remove_avatar' ELSE 'update_avatar' END,
      'profiles',
      v_uid,
      jsonb_build_object('previous_avatar_path', v_prev_path, 'new_avatar_path', v_target_url)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Ignore audit logging failures
  END;

  -- Recompute completeness
  BEGIN
    PERFORM public.get_profile_completeness(v_uid);
  EXCEPTION WHEN OTHERS THEN
    -- Ignore completeness calculation errors
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'previous_avatar_path', v_prev_path,
    'avatar_path', v_target_url,
    'avatar_url', v_target_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_profile_avatar(text, text) TO anon, authenticated, service_role;

-- 4. Re-declare get_profile_completeness checking both avatar_path and avatar_url
CREATE OR REPLACE FUNCTION public.get_profile_completeness(p_profile_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $$
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

  IF (v_p.avatar_path IS NOT NULL AND trim(v_p.avatar_path) <> '')
     OR (v_p.avatar_url IS NOT NULL AND trim(v_p.avatar_url) <> '') THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.get_profile_completeness TO anon, authenticated, service_role;

-- 5. Reload Schema Cache
NOTIFY pgrst, 'reload schema';
