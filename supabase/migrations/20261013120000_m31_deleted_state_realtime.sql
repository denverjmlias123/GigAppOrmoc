-- M31 follow-up: prevent stale lifecycle actions after deletion and sync an already-open chat.
CREATE OR REPLACE FUNCTION public.reject_lifecycle_change_after_gig_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'gig_unavailable: A deleted gig cannot change status.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_lifecycle_change_after_gig_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reject_lifecycle_change_after_gig_delete ON public.gigs;
CREATE TRIGGER reject_lifecycle_change_after_gig_delete
  BEFORE UPDATE OF status ON public.gigs
  FOR EACH ROW EXECUTE FUNCTION public.reject_lifecycle_change_after_gig_delete();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END;
$$;
