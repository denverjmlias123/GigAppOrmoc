-- Let clients and freelancers see newly published or changed gigs without
-- leaving the Browse/My Gigs screens. RLS still controls every delivered row.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'gigs'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.gigs;
    END IF;
END;
$$;
