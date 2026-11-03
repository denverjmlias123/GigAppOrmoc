-- Internal trigger and notification helpers must not be callable through PostgREST.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.notify(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.notify(uuid, text, text, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

-- Older deployed schemas may have this event-trigger helper; clean installs do not.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;
