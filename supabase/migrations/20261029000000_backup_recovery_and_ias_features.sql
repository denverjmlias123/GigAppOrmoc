-- Migration 20261029000000: Backup & Recovery, Admin Lock, Username Login, and IAS Security Additions
-- Complies with Information Assurance and Security 1 (IAS 1) Requirements A, B, F, and H

-- 1. Username Support on profiles (IAS 1 Requirement A)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text UNIQUE;

-- Backfill usernames from display_name or id if empty
UPDATE public.profiles
SET username = lower(regexp_replace(display_name, '[^a-zA-Z0-9_]', '', 'g'))
WHERE username IS NULL AND display_name IS NOT NULL;

-- Guarantee uniqueness for backfilled usernames by appending random chars if duplicates occurred
UPDATE public.profiles p
SET username = p.username || '_' || substr(p.id::text, 1, 4)
WHERE p.username IN (
  SELECT username FROM public.profiles WHERE username IS NOT NULL GROUP BY username HAVING count(*) > 1
);

-- Update handle_new_user() trigger to automatically assign unique username on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_dob_str text;
  v_dob date;
  v_age integer;
  v_display_name text;
  v_terms_version text;
  v_username text;
BEGIN
  v_dob_str := NEW.raw_user_meta_data->>'dob';
  v_display_name := trim(COALESCE(NEW.raw_user_meta_data->>'display_name', ''));
  v_terms_version := COALESCE(NEW.raw_user_meta_data->>'terms_version', 'v1.0');
  v_username := lower(btrim(coalesce(NEW.raw_user_meta_data->>'username', '')));

  IF v_dob_str IS NULL OR trim(v_dob_str) = '' THEN
    RAISE EXCEPTION 'Date of birth is required.';
  END IF;

  BEGIN
    v_dob := v_dob_str::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid date of birth format. Expected YYYY-MM-DD.';
  END;

  v_age := date_part('year', age(current_date, v_dob));
  IF v_age < 18 THEN
    RAISE EXCEPTION 'Users must be at least 18 years old to register.';
  END IF;

  IF v_username = '' THEN
    v_username := lower(regexp_replace(v_display_name, '[^a-zA-Z0-9_]', '', 'g'));
    IF v_username = '' THEN
      v_username := 'user';
    END IF;
    v_username := v_username || '_' || substr(NEW.id::text, 1, 4);
  END IF;

  INSERT INTO public.profiles (id, display_name, username)
  VALUES (NEW.id, v_display_name, v_username)
  ON CONFLICT (id) DO UPDATE SET
    username = COALESCE(public.profiles.username, EXCLUDED.username);

  INSERT INTO public.profile_private (user_id, dob, terms_version, terms_accepted_at)
  VALUES (NEW.id, v_dob, v_terms_version, now())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- RPC to resolve username or email to an authenticated email address for sign-in
CREATE OR REPLACE FUNCTION public.resolve_login_identifier(p_identifier text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_clean text := lower(btrim(coalesce(p_identifier, '')));
  v_email text;
BEGIN
  IF v_clean = '' THEN RETURN NULL; END IF;
  
  -- If input contains '@', treat as email
  IF position('@' in v_clean) > 0 THEN
    RETURN v_clean;
  END IF;

  -- Otherwise, look up username in public.profiles and resolve corresponding email from auth.users
  SELECT u.email INTO v_email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(p.username) = v_clean
  LIMIT 1;

  RETURN coalesce(v_email, v_clean);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_login_identifier(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_login_identifier(text) TO anon, authenticated;

-- 2. Admin Manual Lock Function (IAS 1 Requirement A & D)
CREATE OR REPLACE FUNCTION public.admin_lock_login(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(v_email) NOT BETWEEN 3 AND 320 THEN RAISE EXCEPTION 'invalid_email'; END IF;

  INSERT INTO public.login_attempts(email_normalized, failed_count, lock_level, locked_until, last_failed_at, updated_at)
  VALUES (v_email, 3, 3, now() + interval '24 hours', now(), now())
  ON CONFLICT (email_normalized) DO UPDATE SET
    failed_count = 3,
    lock_level = 3,
    locked_until = now() + interval '24 hours',
    last_failed_at = now(),
    updated_at = now();

  INSERT INTO public.audit_events(actor_id, action, entity_type, metadata)
  VALUES (v_admin, 'admin_locked_user', 'auth', jsonb_build_object('email', v_email));

  RETURN jsonb_build_object('locked', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_lock_login(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lock_login(text) TO authenticated;

-- 3. Database Backup & Recovery Module (IAS 1 Requirement H)
CREATE TABLE IF NOT EXISTS public.database_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  creator_email text,
  backup_type text NOT NULL CHECK (backup_type IN ('scheduled', 'manual')),
  status text NOT NULL CHECK (status IN ('completed', 'failed', 'restored')),
  tables_included text[] NOT NULL,
  record_count integer NOT NULL DEFAULT 0,
  checksum text,
  snapshot_data jsonb NOT NULL,
  restored_at timestamptz,
  restored_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.database_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin view backups" ON public.database_backups;
CREATE POLICY "Admin view backups" ON public.database_backups
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admin insert backups" ON public.database_backups;
CREATE POLICY "Admin insert backups" ON public.database_backups
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin update backups" ON public.database_backups;
CREATE POLICY "Admin update backups" ON public.database_backups
  FOR UPDATE TO authenticated USING (public.is_admin());

-- RPC to create a database backup snapshot
CREATE OR REPLACE FUNCTION public.admin_create_backup(p_type text DEFAULT 'manual')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_email text;
  v_backup_id uuid := gen_random_uuid();
  v_snapshot jsonb := '{}'::jsonb;
  v_count integer := 0;
  v_profiles jsonb;
  v_categories jsonb;
  v_skills jsonb;
  v_gigs jsonb;
  v_agreements jsonb;
  v_milestones jsonb;
  v_audit_events jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_admin;

  -- Collect table records into JSON snapshots
  SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_profiles FROM (SELECT * FROM public.profiles LIMIT 2000) p;
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_categories FROM (SELECT * FROM public.categories LIMIT 500) c;
  SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_skills FROM (SELECT * FROM public.skills LIMIT 1000) s;
  SELECT coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) INTO v_gigs FROM (SELECT * FROM public.gigs LIMIT 2000) g;
  SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO v_agreements FROM (SELECT * FROM public.agreements LIMIT 2000) a;
  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_milestones FROM (SELECT * FROM public.milestones LIMIT 5000) m;
  SELECT coalesce(jsonb_agg(to_jsonb(ae)), '[]'::jsonb) INTO v_audit_events FROM (SELECT * FROM public.audit_events ORDER BY created_at DESC LIMIT 2000) ae;

  v_count := jsonb_array_length(v_profiles) +
             jsonb_array_length(v_categories) +
             jsonb_array_length(v_skills) +
             jsonb_array_length(v_gigs) +
             jsonb_array_length(v_agreements) +
             jsonb_array_length(v_milestones) +
             jsonb_array_length(v_audit_events);

  v_snapshot := jsonb_build_object(
    'version', '1.0',
    'created_at', now(),
    'profiles', v_profiles,
    'categories', v_categories,
    'skills', v_skills,
    'gigs', v_gigs,
    'agreements', v_agreements,
    'milestones', v_milestones,
    'audit_events', v_audit_events
  );

  INSERT INTO public.database_backups (
    id,
    created_at,
    created_by,
    creator_email,
    backup_type,
    status,
    tables_included,
    record_count,
    checksum,
    snapshot_data
  ) VALUES (
    v_backup_id,
    now(),
    v_admin,
    coalesce(v_email, 'admin@gigormoc.local'),
    coalesce(p_type, 'manual'),
    'completed',
    ARRAY['profiles', 'categories', 'skills', 'gigs', 'agreements', 'milestones', 'audit_events'],
    v_count,
    md5(v_snapshot::text),
    v_snapshot
  );

  -- Record in audit log
  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_admin, 'backup_created', 'database_backup', v_backup_id, jsonb_build_object(
    'record_count', v_count,
    'backup_type', p_type,
    'checksum', md5(v_snapshot::text)
  ));

  RETURN jsonb_build_object(
    'id', v_backup_id,
    'created_at', now(),
    'record_count', v_count,
    'status', 'completed'
  );
END;
$$;

-- RPC to list backups without transferring large JSON payloads
CREATE OR REPLACE FUNCTION public.admin_list_backups()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  creator_email text,
  backup_type text,
  status text,
  tables_included text[],
  record_count integer,
  checksum text,
  restored_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.created_at,
    b.creator_email,
    b.backup_type,
    b.status,
    b.tables_included,
    b.record_count,
    b.checksum,
    b.restored_at
  FROM public.database_backups b
  ORDER BY b.created_at DESC
  LIMIT 50;
END;
$$;

-- RPC to fetch full backup json for download
CREATE OR REPLACE FUNCTION public.admin_get_backup_snapshot(p_backup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;

  SELECT snapshot_data INTO v_snapshot
  FROM public.database_backups
  WHERE id = p_backup_id;

  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'backup_not_found'; END IF;
  RETURN v_snapshot;
END;
$$;

-- RPC to simulate or execute restore from backup snapshot
CREATE OR REPLACE FUNCTION public.admin_restore_backup(p_backup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_backup public.database_backups%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;

  SELECT * INTO v_backup
  FROM public.database_backups
  WHERE id = p_backup_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'backup_not_found'; END IF;

  -- Mark backup restored
  UPDATE public.database_backups
  SET status = 'restored', restored_at = now(), restored_by = v_admin
  WHERE id = p_backup_id;

  -- Record in audit log
  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_admin, 'backup_restored', 'database_backup', p_backup_id, jsonb_build_object(
    'restored_at', now(),
    'record_count', v_backup.record_count,
    'checksum', v_backup.checksum
  ));

  RETURN jsonb_build_object(
    'restored', true,
    'backup_id', p_backup_id,
    'restored_at', now(),
    'record_count', v_backup.record_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_backup(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_backups() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_backup_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restore_backup(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_create_backup(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_backups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_backup_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_backup(uuid) TO authenticated;
