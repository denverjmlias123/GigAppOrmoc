-- Migration 20261104000001: Add missing profiles columns and sync status

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated', 'deleted')),
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS is_legit_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS freelancer_rating_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_rating_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freelancer_completed_gigs integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_completed_gigs integer NOT NULL DEFAULT 0;

UPDATE public.profiles SET status = CASE WHEN is_active = false THEN 'suspended' ELSE 'active' END WHERE status IS NULL OR status = '';
UPDATE public.profiles SET area = area_barangay WHERE area IS NULL AND area_barangay IS NOT NULL;
UPDATE public.profiles SET is_legit_verified = (verification_status = 'verified') WHERE is_legit_verified IS FALSE AND verification_status = 'verified';

CREATE OR REPLACE FUNCTION public.sync_profile_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT NULL THEN
    NEW.is_active := (NEW.status = 'active');
  ELSIF NEW.is_active IS NOT NULL THEN
    NEW.status := CASE WHEN NEW.is_active THEN 'active' ELSE 'suspended' END;
  END IF;
  IF NEW.area IS NOT NULL AND NEW.area_barangay IS NULL THEN
    NEW.area_barangay := NEW.area;
  ELSIF NEW.area_barangay IS NOT NULL AND NEW.area IS NULL THEN
    NEW.area := NEW.area_barangay;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_status ON public.profiles;
CREATE TRIGGER trg_sync_profile_status
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_status();

-- Re-create admin_dashboard_metrics with verified column references
CREATE OR REPLACE FUNCTION public.admin_dashboard_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_latest jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_latest FROM (
      SELECT id, created_at, actor_email, actor_role, action, entity_type, status
      FROM public.audit_events ORDER BY created_at DESC LIMIT 10
    ) x;
  RETURN jsonb_build_object(
    'total_users', (SELECT count(*) FROM public.profiles WHERE coalesce(status, 'active') <> 'deleted'),
    'new_users_7_days', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'active_gigs', (SELECT count(*) FROM public.gigs WHERE status = 'open'),
    'agreements_in_progress', (SELECT count(*) FROM public.agreements WHERE status = 'active'),
    'completed_agreements', (SELECT count(*) FROM public.agreements WHERE status = 'completed'),
    'open_reports', (SELECT count(*) FROM public.reports WHERE status = 'pending'),
    'locked_accounts', 0,
    'today_log_events', (SELECT count(*) FROM public.audit_events WHERE created_at >= date_trunc('day', now())),
    'latest_activity', coalesce(v_latest, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_metrics() TO authenticated;
